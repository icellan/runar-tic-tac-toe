import { useState, useEffect, useRef, useCallback } from 'react'
import type { Game } from '../lib/types'
import { signer } from '../lib/wallet'
import { provider, artifact, estimateFee, pubkeyToPKH } from '../lib/wallet-provider'
import { broadcastGameState } from '../lib/api'
import { TicTacToeContract } from '../generated/TicTacToeContract'

const CANCEL_MESSAGE_BOX = 'tic-tac-toe-cancel'

interface CancelMessage {
  type: 'propose' | 'approve'
  gameId: string
  sighash?: string
  signature?: string
  preparedCall?: string
}

/** Load the on-chain contract from local game state. */
function loadContract(game: Game) {
  const contract = TicTacToeContract.fromUtxo(artifact, {
    txid: game.txid,
    outputIndex: game.outputIndex,
    satoshis: game.satoshis,
    script: game.lockingScript,
  })
  contract.connect(provider, signer)
  return contract
}

export function useCancelFlow(
  game: Game | null,
  derivedKey: string,
  identityKey: string,
  isPlayerX: boolean,
  isPlayerO: boolean,
  setGame: (g: Game) => void,
  roomId: string | undefined,
) {
  const [cancelProposal, setCancelProposal] = useState<CancelMessage | null>(null)
  const [cancelProposed, setCancelProposed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const messageBoxRef = useRef<any>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Initialize MessageBox client and poll for cancel messages
  useEffect(() => {
    if (!game || game.status !== 1 || !identityKey || !roomId) return
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
                if (parsed.gameId === roomId) {
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
  }, [roomId, game?.status, identityKey, derivedKey])

  const handleCancel = useCallback(async () => {
    if (!game || !derivedKey || !roomId) return
    setLoading(true)
    setError('')
    try {
      const fee = estimateFee()
      await provider.ensureFunding(fee)
      const contract = loadContract(game)
      const changePKH = pubkeyToPKH(derivedKey)
      // The contract UTXO was funded with betAmount + feeMargin at deploy;
      // payout is betAmount, so the surplus goes back as change.
      const changeAmount = game.satoshis - game.betAmount
      const { txid } = await contract.cancelBeforeJoin(changePKH, BigInt(Math.max(0, changeAmount)), [
        { address: game.playerX, satoshis: game.betAmount },
      ])

      const newGame: Game = { ...game, txid, status: 5, satoshis: 0, updatedAt: new Date().toISOString() }
      await broadcastGameState(roomId, newGame)
      setGame(newGame)
    } catch (err: any) {
      console.error('[cancel]', err)
      setError('Failed to cancel game')
    } finally {
      setLoading(false)
    }
  }, [game, derivedKey, roomId, setGame])

  const handleProposeCancel = useCallback(async () => {
    if (!game || !derivedKey || !messageBoxRef.current || !roomId) return
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
        body: JSON.stringify({ type: 'propose', gameId: roomId }),
      })
      setCancelProposed(true)
    } catch (err: any) {
      console.error('[propose-cancel]', err)
      setError('Failed to propose cancellation')
    } finally {
      setLoading(false)
    }
  }, [game, derivedKey, isPlayerX, roomId])

  const handleApproveCancel = useCallback(async () => {
    if (!game || !derivedKey || !messageBoxRef.current || !roomId) return
    setLoading(true)
    setError('')
    try {
      const fee = estimateFee()
      const contract = loadContract(game)
      // Change goes to the opponent (proposer) who will finalize and fund the tx
      const opponentKey = isPlayerX ? game.playerO : game.playerX
      const changePKH = pubkeyToPKH(opponentKey)
      const prepared = await contract.prepareCancel(changePKH, BigInt(fee), [
        { address: game.playerX, satoshis: game.betAmount },
        { address: game.playerO, satoshis: game.betAmount },
      ])
      const mySigHex = await signer.signHash(prepared.sighash)
      const opponentIdentityKey = isPlayerX ? game.identityKeyO : game.identityKeyX
      if (!opponentIdentityKey) {
        setError('Opponent identity key not available')
        return
      }
      const msg: CancelMessage = {
        type: 'approve',
        gameId: roomId,
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
  }, [game, derivedKey, isPlayerX, roomId])

  const handleSignCancel = useCallback(async () => {
    if (!game || !derivedKey || !cancelProposal?.sighash || !cancelProposal?.preparedCall || !roomId) return
    setLoading(true)
    setError('')
    try {
      // Fund fee + the change amount the approver baked into prepareCancel
      const fee = estimateFee()
      await provider.ensureFunding(fee * 2)
      const mySigHex = await signer.signHash(cancelProposal.sighash)
      const prepared = JSON.parse(cancelProposal.preparedCall)
      const approverSig = cancelProposal.signature!
      const sigX = isPlayerX ? mySigHex : approverSig
      const sigO = isPlayerX ? approverSig : mySigHex
      const contract = loadContract(game)
      const { txid } = await contract.finalizeCancel(prepared, sigX, sigO)

      const newGame: Game = { ...game, txid, status: 5, satoshis: 0, updatedAt: new Date().toISOString() }
      await broadcastGameState(roomId, newGame)
      setGame(newGame)
    } catch (err: any) {
      console.error('[sign-cancel]', err)
      setError('Failed to sign cancellation')
    } finally {
      setLoading(false)
    }
  }, [game, derivedKey, cancelProposal, isPlayerX, roomId, setGame])

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
