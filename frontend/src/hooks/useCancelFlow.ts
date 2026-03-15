import { useState, useEffect, useRef, useCallback } from 'react'
import type { Game } from '../lib/types'
import { signer } from '../lib/wallet'
import { provider, artifact, estimateFee } from '../lib/wallet-provider'
import { recordAction, prepareSpend } from '../lib/api'
import { TicTacToeContract } from '../generated/TicTacToeContract'

const CANCEL_MESSAGE_BOX = 'tic-tac-toe-cancel'

interface CancelMessage {
  type: 'propose' | 'approve'
  gameId: string
  sighash?: string
  signature?: string
  preparedCall?: string
}

async function loadContract(gameId: string) {
  const prep = await prepareSpend(gameId)
  const contract = TicTacToeContract.fromUtxo(artifact, {
    txid: prep.contractTxid,
    outputIndex: prep.contractVout,
    satoshis: prep.contractSatoshis,
    script: prep.lockingScript,
  })
  contract.connect(provider, signer)
  return { contract, prep }
}

export function useCancelFlow(
  game: Game | null,
  derivedKey: string,
  identityKey: string,
  isPlayerX: boolean,
  isPlayerO: boolean,
  setGame: (g: Game) => void,
) {
  const [cancelProposal, setCancelProposal] = useState<CancelMessage | null>(null)
  const [cancelProposed, setCancelProposed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const messageBoxRef = useRef<any>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Initialize MessageBox client and poll for cancel messages
  useEffect(() => {
    if (!game || game.status !== 1 || !identityKey) return
    const isPlayer = game.playerX === derivedKey || game.playerO === derivedKey
    if (!isPlayer) return

    let active = true

    async function initMessageBox() {
      try {
        const { MessageBoxClient } = await import('@bsv/message-box-client')
        const { wallet } = await import('../lib/wallet')
        const client = new MessageBoxClient({ walletClient: wallet as any, networkPreset: 'mainnet' })
        await client.init()
        messageBoxRef.current = client

        const poll = async () => {
          if (!active || !messageBoxRef.current) return
          try {
            const messages = await messageBoxRef.current.listMessages({ messageBox: CANCEL_MESSAGE_BOX })
            for (const msg of messages || []) {
              try {
                const parsed: CancelMessage = JSON.parse(msg.body)
                if (game && parsed.gameId === game.gameId) {
                  if (parsed.type === 'propose' || (parsed.type === 'approve' && parsed.signature && parsed.preparedCall)) {
                    setCancelProposal(parsed)
                  }
                  await messageBoxRef.current.acknowledgeMessage({ messageIds: [msg.messageId] })
                }
              } catch { /* skip unparseable */ }
            }
          } catch (err) {
            console.warn('[MessageBox] poll error:', err)
          }
        }

        poll()
        pollIntervalRef.current = setInterval(poll, 5000)
      } catch (err) {
        console.error('[MessageBox] init error:', err)
      }
    }

    initMessageBox()

    return () => {
      active = false
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
      messageBoxRef.current = null
    }
  }, [game?.gameId, game?.status, identityKey, derivedKey])

  const handleCancel = useCallback(async () => {
    if (!game || !derivedKey) return
    setLoading(true)
    setError('')
    try {
      const { contract, prep } = await loadContract(game.gameId)
      const noChangePKH = '00'.repeat(20)
      const { txid } = await contract.cancelBeforeJoin(noChangePKH, 0n, [
        { address: prep.playerX, satoshis: prep.betAmount },
      ])
      await recordAction(game.gameId, txid, 'cancelBeforeJoin', {})
      setGame({ ...game, status: 5 })
    } catch (err: any) {
      console.error('[cancel]', err)
      setError('Failed to cancel game')
    } finally {
      setLoading(false)
    }
  }, [game, derivedKey, setGame])

  const handleProposeCancel = useCallback(async () => {
    if (!game || !derivedKey || !messageBoxRef.current) return
    setLoading(true)
    setError('')
    try {
      const opponentIdentityKey = isPlayerX ? game.identityKeyO : game.identityKeyX
      if (!opponentIdentityKey) {
        setError('Opponent identity key not available yet. Try again shortly.')
        return
      }
      await messageBoxRef.current.sendMessage({
        recipient: opponentIdentityKey,
        messageBox: CANCEL_MESSAGE_BOX,
        body: JSON.stringify({ type: 'propose', gameId: game.gameId }),
      })
      setCancelProposed(true)
    } catch (err: any) {
      console.error('[propose-cancel]', err)
      setError('Failed to propose cancellation')
    } finally {
      setLoading(false)
    }
  }, [game, derivedKey, isPlayerX])

  const handleApproveCancel = useCallback(async () => {
    if (!game || !derivedKey || !messageBoxRef.current) return
    setLoading(true)
    setError('')
    try {
      const { contract, prep } = await loadContract(game.gameId)
      const noChangePKH = '00'.repeat(20)
      const prepared = await contract.prepareCancel(noChangePKH, 0n, [
        { address: prep.playerX, satoshis: prep.betAmount },
        { address: prep.playerO, satoshis: prep.betAmount },
      ])
      const mySigHex = await signer.signHash(prepared.sighash)
      const opponentIdentityKey = isPlayerX ? game.identityKeyO : game.identityKeyX
      if (!opponentIdentityKey) {
        setError('Opponent identity key not available')
        return
      }
      const msg: CancelMessage = {
        type: 'approve',
        gameId: game.gameId,
        sighash: prepared.sighash,
        signature: mySigHex,
        preparedCall: JSON.stringify(prepared),
      }
      await messageBoxRef.current.sendMessage({
        recipient: opponentIdentityKey,
        messageBox: CANCEL_MESSAGE_BOX,
        body: JSON.stringify(msg),
      })
      setCancelProposal({ ...msg })
    } catch (err: any) {
      console.error('[approve-cancel]', err)
      setError('Failed to approve cancellation')
    } finally {
      setLoading(false)
    }
  }, [game, derivedKey, isPlayerX])

  const handleSignCancel = useCallback(async () => {
    if (!game || !derivedKey || !cancelProposal?.sighash || !cancelProposal?.preparedCall) return
    setLoading(true)
    setError('')
    try {
      const mySigHex = await signer.signHash(cancelProposal.sighash)
      const prepared = JSON.parse(cancelProposal.preparedCall)
      const approverSig = cancelProposal.signature!
      const sigX = isPlayerX ? mySigHex : approverSig
      const sigO = isPlayerX ? approverSig : mySigHex
      const { contract } = await loadContract(game.gameId)
      const { txid } = await contract.finalizeCancel(prepared, sigX, sigO)
      await recordAction(game.gameId, txid, 'cancel', {})
      setGame({ ...game, status: 5 })
    } catch (err: any) {
      console.error('[sign-cancel]', err)
      setError('Failed to sign cancellation')
    } finally {
      setLoading(false)
    }
  }, [game, derivedKey, cancelProposal, isPlayerX, setGame])

  return {
    cancelProposal,
    cancelProposed,
    cancelLoading: loading,
    cancelError: error,
    handleCancel,
    handleProposeCancel,
    handleApproveCancel,
    handleSignCancel,
  }
}
