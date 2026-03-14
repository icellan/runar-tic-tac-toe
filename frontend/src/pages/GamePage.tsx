import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useGame } from '../hooks/useGame'
import { useWallet } from '../hooks/useWallet'
import GameBoard from '../components/GameBoard'
import PlayerBadge from '../components/PlayerBadge'
import BetDisplay from '../components/BetDisplay'
import MoveLog from '../components/MoveLog'
import { recordAction, registerIdentityKey } from '../lib/api'
import { getDerivedPubKey, getWalletIdentityKey, signContractHash } from '../lib/wallet'
import { loadGameContract, estimateTxFee } from '../lib/game-contract'
import { ensureFundingUtxos } from '../lib/wallet-provider'
import { analyzeMove } from '../lib/game-logic'
import { Utils } from '@bsv/sdk'
import { STATUS_LABELS } from '../lib/types'

const CANCEL_MESSAGE_BOX = 'tic-tac-toe-cancel'

interface CancelMessage {
  type: 'propose' | 'approve'
  gameId: string
  sighash?: string
  signature?: string
  preparedCall?: string
}

const ERROR_LABELS: Record<string, string> = {
  'move': 'Failed to make move',
  'join': 'Failed to join game',
  'cancel': 'Failed to cancel game',
  'propose-cancel': 'Failed to propose cancellation',
  'approve-cancel': 'Failed to approve cancellation',
  'sign-cancel': 'Failed to sign cancellation',
}

function handleError(err: any, context: string): string {
  console.error(`[${context}]`, err)
  if (err?.args) console.error(`[${context}] args:`, JSON.stringify(err.args, null, 2))
  return ERROR_LABELS[context] || 'Something went wrong'
}

export default function GamePage() {
  const { id } = useParams<{ id: string }>()
  const { game, loading, error, setGame } = useGame(id)
  const { connected, pubkey } = useWallet()
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')
  const [winLine, setWinLine] = useState<number[] | null>(null)
  const [derivedKey, setDerivedKey] = useState('')
  const [identityKey, setIdentityKey] = useState('')
  const [cancelProposal, setCancelProposal] = useState<CancelMessage | null>(null)
  const [cancelProposed, setCancelProposed] = useState(false)
  const messageBoxRef = useRef<any>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (connected) {
      getDerivedPubKey().then(setDerivedKey).catch((err) => {
        console.error('Failed to get derived pubkey:', err)
        setActionError('Failed to get derived key: ' + (err?.message || err))
      })
      getWalletIdentityKey().then((key) => {
        if (key) setIdentityKey(key)
      }).catch(console.error)
    }
  }, [connected])

  // Register identity key with overlay when we know both game and identity
  useEffect(() => {
    if (!game || !derivedKey || !identityKey) return
    const isPlayer = game.playerX === derivedKey || game.playerO === derivedKey
    if (!isPlayer) return
    registerIdentityKey(game.currentTxid, derivedKey, identityKey).catch(console.error)
  }, [game?.currentTxid, derivedKey, identityKey])

  // Initialize MessageBox client and poll for cancel messages
  useEffect(() => {
    if (!game || game.status !== 1 || !connected || !identityKey) return
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

        // Poll for cancel messages
        const poll = async () => {
          if (!active || !messageBoxRef.current) return
          try {
            const messages = await messageBoxRef.current.listMessages({ messageBox: CANCEL_MESSAGE_BOX })
            for (const msg of messages || []) {
              try {
                const parsed: CancelMessage = JSON.parse(msg.body)
                if (game && parsed.gameId === game.gameId) {
                  if (parsed.type === 'propose') {
                    setCancelProposal(parsed)
                  } else if (parsed.type === 'approve' && parsed.signature && parsed.preparedCall) {
                    setCancelProposal(parsed)
                  }
                  // Acknowledge the message
                  await messageBoxRef.current.acknowledgeMessage({ messageIds: [msg.messageId] })
                }
              } catch {
                // skip unparseable messages
              }
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
  }, [game?.gameId, game?.status, connected, identityKey, derivedKey])

  const isPlayerX = game?.playerX === derivedKey
  const isPlayerO = game?.playerO === derivedKey
  const isMyTurn = game?.status === 1 && (
    (game.turn === 1 && isPlayerX) || (game.turn === 2 && isPlayerO)
  )

  const handleCellClick = useCallback(async (index: number) => {
    if (!game || !isMyTurn || actionLoading || !derivedKey) return

    setActionLoading(true)
    setActionError('')

    try {
      if (game.board[index] !== '0') {
        setActionError('Cell already occupied')
        return
      }

      const moveResult = analyzeMove(game.board, index, game.turn, game.playerX, game.playerO)
      const contractSatoshis = game.betAmount * 2

      // Ensure we have funding UTXOs for the move tx fee
      if (moveResult.method === 'move') {
        await ensureFundingUtxos(estimateTxFee())
      }

      const { contract, prep } = await loadGameContract(game.gameId)
      let txid: string

      // For terminal methods, pass dummy change params (no change output yet —
      // pending SDK support for fundingUtxos in terminal calls)
      const noChangePKH = '00'.repeat(20)

      if (moveResult.method === 'moveAndWin') {
        const result = await contract.moveAndWin(BigInt(index), null, noChangePKH, 0n, [
          { address: moveResult.winnerPubkey!, satoshis: contractSatoshis },
        ])
        txid = result.txid
      } else if (moveResult.method === 'moveAndTie') {
        const result = await contract.moveAndTie(BigInt(index), null, noChangePKH, 0n, [
          { address: moveResult.playerX!, satoshis: game.betAmount },
          { address: moveResult.playerO!, satoshis: game.betAmount },
        ])
        txid = result.txid
      } else {
        const result = await contract.move(BigInt(index), null, {
          satoshis: prep.contractSatoshis,
        })
        txid = result.txid
      }

      const broadcastResult = await recordAction(game.gameId, txid, moveResult.method, { position: index })

      if (moveResult.winLine) {
        setWinLine(moveResult.winLine)
      }

      setGame(broadcastResult.game)
    } catch (err: any) {
      setActionError(handleError(err, 'move'))
    } finally {
      setActionLoading(false)
    }
  }, [game, isMyTurn, actionLoading, derivedKey, setGame])

  const handleJoin = useCallback(async () => {
    if (!game || !connected || !derivedKey || isPlayerX) return

    setActionLoading(true)
    setActionError('')

    try {
      console.log('[handleJoin] starting join flow')
      // Ensure we have funding UTXOs for the join (bet amount + tx fee)
      await ensureFundingUtxos(game.betAmount + estimateTxFee())
      console.log('[handleJoin] funding ensured')

      const { contract, prep } = await loadGameContract(game.gameId)
      const result = await contract.join(null, {
        satoshis: game.betAmount * 2,
      })

      const broadcastResult = await recordAction(game.gameId, result.txid, 'join', { opponentPubKey: derivedKey })
      setGame(broadcastResult.game)

      // Register identity key after joining
      if (identityKey) {
        registerIdentityKey(result.txid, derivedKey, identityKey).catch(console.error)
      }
    } catch (err: any) {
      setActionError(handleError(err, 'join'))
    } finally {
      setActionLoading(false)
    }
  }, [game, connected, derivedKey, isPlayerX, identityKey, setGame])

  const handleCancel = useCallback(async () => {
    if (!game || !connected || !derivedKey) return

    setActionLoading(true)
    setActionError('')

    try {
      const { contract, prep } = await loadGameContract(game.gameId)
      const noChangePKH = '00'.repeat(20)
      const { txid } = await contract.cancelBeforeJoin(noChangePKH, 0n, [
        { address: prep.playerX, satoshis: prep.betAmount },
      ])

      await recordAction(game.gameId, txid, 'cancelBeforeJoin', {})
      setGame({ ...game, status: 5 })
    } catch (err: any) {
      setActionError(handleError(err, 'cancel'))
    } finally {
      setActionLoading(false)
    }
  }, [game, connected, derivedKey, setGame])

  // Propose mutual cancellation via MessageBox
  const handleProposeCancel = useCallback(async () => {
    if (!game || !derivedKey || !messageBoxRef.current) return

    setActionLoading(true)
    setActionError('')
    try {
      const opponentIdentityKey = isPlayerX ? game.identityKeyO : game.identityKeyX
      if (!opponentIdentityKey) {
        setActionError('Opponent identity key not available yet. Try again shortly.')
        return
      }

      const msg: CancelMessage = {
        type: 'propose',
        gameId: game.gameId,
      }
      await messageBoxRef.current.sendMessage({
        recipient: opponentIdentityKey,
        messageBox: CANCEL_MESSAGE_BOX,
        body: JSON.stringify(msg),
      })
      setCancelProposed(true)
    } catch (err: any) {
      setActionError(handleError(err, 'propose-cancel'))
    } finally {
      setActionLoading(false)
    }
  }, [game, derivedKey, isPlayerX])

  // Approve cancel: prepare tx, sign my part, send back via MessageBox
  const handleApproveCancel = useCallback(async () => {
    if (!game || !derivedKey || !messageBoxRef.current) return

    setActionLoading(true)
    setActionError('')
    try {
      const { contract, prep } = await loadGameContract(game.gameId)
      const noChangePKH = '00'.repeat(20)
      const prepared = await contract.prepareCancel(noChangePKH, 0n, [
        { address: prep.playerX, satoshis: prep.betAmount },
        { address: prep.playerO, satoshis: prep.betAmount },
      ])

      const sighashBytes = Utils.toArray(prepared.sighash, 'hex')
      const mySig = await signContractHash(sighashBytes)
      const mySigHex = Utils.toHex(mySig)

      const opponentIdentityKey = isPlayerX ? game.identityKeyO : game.identityKeyX
      if (!opponentIdentityKey) {
        setActionError('Opponent identity key not available')
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
      setActionError(handleError(err, 'approve-cancel'))
    } finally {
      setActionLoading(false)
    }
  }, [game, derivedKey, isPlayerX])

  // Finalize cancel: sign my part and broadcast
  const handleSignCancel = useCallback(async () => {
    if (!game || !derivedKey || !cancelProposal?.sighash || !cancelProposal?.preparedCall) return

    setActionLoading(true)
    setActionError('')
    try {
      const sighashBytes = Utils.toArray(cancelProposal.sighash, 'hex')
      const mySig = await signContractHash(sighashBytes)
      const mySigHex = Utils.toHex(mySig)

      const prepared = JSON.parse(cancelProposal.preparedCall)
      const approverSig = cancelProposal.signature!
      // The proposer is the one who initiated cancel; the approver sent back their sig
      // If I'm the proposer, the approval came from the opponent
      const sigX = isPlayerX ? mySigHex : approverSig
      const sigO = isPlayerX ? approverSig : mySigHex

      const { contract } = await loadGameContract(game.gameId)
      const { txid } = await contract.finalizeCancel(prepared, sigX, sigO)

      await recordAction(game.gameId, txid, 'cancel', {})
      setGame({ ...game, status: 5 })
    } catch (err: any) {
      setActionError(handleError(err, 'sign-cancel'))
    } finally {
      setActionLoading(false)
    }
  }, [game, derivedKey, cancelProposal, isPlayerX, setGame])

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-dim)' }}>Loading game...</div>
  }

  if (error || !game) {
    return <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-error)' }}>{error || 'Game not found'}</div>
  }

  const gameOver = game.status >= 2
  const statusLabel = STATUS_LABELS[game.status]

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', overflow: 'hidden' }}>
      {gameOver && (
        <div style={{
          textAlign: 'center',
          padding: '16px 24px',
          marginBottom: 24,
          borderRadius: 'var(--radius)',
          background: game.status === 4 ? 'rgba(136, 136, 170, 0.1)' : 'rgba(255, 217, 61, 0.1)',
          border: `1px solid ${game.status === 4 ? 'var(--color-text-dim)' : 'var(--color-accent)'}`,
          fontSize: 18,
          fontWeight: 700,
        }}>
          {statusLabel}
        </div>
      )}

      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <BetDisplay betAmount={game.betAmount} status={game.status} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        <div style={{ flex: '1 1 120px', minWidth: 0 }}>
          <PlayerBadge label="Player X" pubkey={game.playerX} isCurrentTurn={game.status === 1 && game.turn === 1} mark="X" />
        </div>
        <div style={{ flex: '1 1 120px', minWidth: 0 }}>
          <PlayerBadge label="Player O" pubkey={game.playerO} isCurrentTurn={game.status === 1 && game.turn === 2} mark="O" />
        </div>
      </div>

      <div className="card" style={{ padding: '24px 16px', marginBottom: 16 }}>
        <GameBoard board={game.board} onCellClick={handleCellClick} disabled={!isMyTurn || actionLoading || gameOver} winLine={winLine} />
        {actionLoading && (
          <div style={{ textAlign: 'center', marginTop: 16, color: 'var(--color-text-dim)', fontSize: 13 }}>Processing...</div>
        )}
        {actionError && (
          <div style={{ textAlign: 'center', marginTop: 16, color: 'var(--color-error)', fontSize: 13 }}>{actionError}</div>
        )}
      </div>

      {game.status === 0 && connected && derivedKey && !isPlayerX && (
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <button className="btn-primary" style={{ padding: '14px 32px', fontSize: 16 }} onClick={handleJoin} disabled={actionLoading}>
            {actionLoading ? 'Joining...' : `Accept Challenge (${game.betAmount.toLocaleString()} sats)`}
          </button>
        </div>
      )}

      {game.status === 0 && isPlayerX && (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--color-text-dim)', fontSize: 14, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', marginBottom: 24 }}>
          Waiting for an opponent to join...
          <div style={{ marginTop: 8, fontSize: 12 }}>
            Share this URL: <code style={{ color: 'var(--color-accent)' }}>{window.location.href}</code>
          </div>
          <button className="btn-secondary" style={{ marginTop: 16, fontSize: 13 }} onClick={handleCancel} disabled={actionLoading}>
            {actionLoading ? 'Cancelling...' : 'Cancel Game'}
          </button>
        </div>
      )}

      {game.status === 1 && !gameOver && (
        <div style={{ textAlign: 'center', padding: 12, fontSize: 14, color: isMyTurn ? 'var(--color-accent)' : 'var(--color-text-dim)', fontWeight: isMyTurn ? 600 : 400 }}>
          {isMyTurn ? 'Your turn!' : "Opponent's turn..."}
        </div>
      )}

      {game.status === 1 && connected && (isPlayerX || isPlayerO) && (() => {
        // Cancel proposal received from opponent
        if (cancelProposal?.type === 'propose') {
          return (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 13, marginBottom: 8, color: 'var(--color-accent)' }}>Opponent wants to cancel the game</div>
              <button className="btn-primary" style={{ fontSize: 13, padding: '8px 20px' }} onClick={handleApproveCancel} disabled={actionLoading}>
                {actionLoading ? 'Processing...' : 'Approve Cancel'}
              </button>
            </div>
          )
        }

        // Approval received from opponent — I can finalize
        if (cancelProposal?.type === 'approve' && cancelProposal.signature) {
          return (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 13, marginBottom: 8, color: 'var(--color-accent)' }}>Opponent approved cancel. Sign to complete:</div>
              <button className="btn-primary" style={{ fontSize: 13, padding: '8px 20px' }} onClick={handleSignCancel} disabled={actionLoading}>
                {actionLoading ? 'Signing...' : 'Sign Cancel'}
              </button>
            </div>
          )
        }

        // I proposed, waiting for response
        if (cancelProposed) {
          return <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 13, color: 'var(--color-text-dim)' }}>Cancel proposed. Waiting for opponent to respond...</div>
        }

        // No cancel in progress — show propose button
        return (
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <button className="btn-secondary" style={{ fontSize: 12, padding: '6px 16px' }} onClick={handleProposeCancel} disabled={actionLoading}>
              Propose Cancel
            </button>
          </div>
        )
      })()}

      <div className="card" style={{ padding: 16 }}>
        <MoveLog game={game} />
      </div>

      <div style={{ marginTop: 16, fontSize: 11, color: 'var(--color-text-dim)', textAlign: 'center', wordBreak: 'break-all' }}>
        Game: {game.gameId}
        <br />
        Current TX: {game.currentTxid}
      </div>
    </div>
  )
}
