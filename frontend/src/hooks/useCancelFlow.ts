import { useState, useCallback } from 'react'
import { useMessageBoxPoller } from 'runar-react'
import type { Game } from '../lib/types'
import { signer, wallet } from '../lib/wallet'
import { provider, estimateFee, pubkeyToPKH, loadContract } from '../lib/wallet-provider'
import { broadcastGameState } from '../lib/api'

const CANCEL_MESSAGE_BOX = 'tic-tac-toe-cancel'

interface CancelMessage {
  type: 'propose' | 'approve'
  gameId: string
  sighash?: string
  signature?: string
  preparedCall?: string
}

export function useCancelFlow(
  game: Game | null,
  derivedKey: string,
  identityKey: string,
  isPlayerX: boolean,
  setGame: (g: Game) => void,
  roomId: string | undefined,
) {
  const [cancelProposal, setCancelProposal] = useState<CancelMessage | null>(null)
  const [cancelProposed, setCancelProposed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isPlayer = !!game && (game.playerX === derivedKey || game.playerO === derivedKey)
  const pollerEnabled = !!game && game.status === 1 && !!identityKey && !!roomId && isPlayer

  const { send: sendMessage } = useMessageBoxPoller({
    boxName: CANCEL_MESSAGE_BOX,
    walletClient: wallet,
    networkPreset: 'mainnet',
    filter: (parsed: CancelMessage) => parsed?.gameId === roomId,
    onMessage: (parsed: CancelMessage) => {
      if (parsed.type === 'propose' || (parsed.type === 'approve' && parsed.signature && parsed.preparedCall)) {
        setCancelProposal(parsed)
      }
    },
    enabled: pollerEnabled,
  })

  const handleCancel = useCallback(async () => {
    if (!game || !derivedKey || !roomId) return
    setLoading(true)
    setError('')
    try {
      const fee = estimateFee()
      await provider.ensureFunding(fee)
      const contract = loadContract(game)
      const changePKH = pubkeyToPKH(derivedKey)
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
    if (!game || !derivedKey || !roomId) return
    setLoading(true)
    setError('')
    try {
      const opponentIdentityKey = isPlayerX ? game.identityKeyO : game.identityKeyX
      if (!opponentIdentityKey) {
        setError('Opponent identity key not available yet. Try again shortly.')
        return
      }
      await sendMessage(opponentIdentityKey, JSON.stringify({ type: 'propose', gameId: roomId }))
      setCancelProposed(true)
    } catch (err: any) {
      console.error('[propose-cancel]', err)
      setError('Failed to propose cancellation')
    } finally {
      setLoading(false)
    }
  }, [game, derivedKey, isPlayerX, roomId, sendMessage])

  const handleApproveCancel = useCallback(async () => {
    if (!game || !derivedKey || !roomId) return
    setLoading(true)
    setError('')
    try {
      const fee = estimateFee()
      const contract = loadContract(game)
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
      await sendMessage(opponentIdentityKey, JSON.stringify(msg))
      setCancelProposal({ ...msg })
    } catch (err: any) {
      console.error('[approve-cancel]', err)
      setError('Failed to approve cancellation')
    } finally {
      setLoading(false)
    }
  }, [game, derivedKey, isPlayerX, roomId, sendMessage])

  const handleSignCancel = useCallback(async () => {
    if (!game || !derivedKey || !cancelProposal?.sighash || !cancelProposal?.preparedCall || !roomId) return
    setLoading(true)
    setError('')
    try {
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
