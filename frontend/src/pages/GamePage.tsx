import { useState, useCallback, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useGame } from '../hooks/useGame'
import { useWallet } from '../hooks/useWallet'
import { useDerivedKey } from '../hooks/useDerivedKey'
import { useCancelFlow } from '../hooks/useCancelFlow'
import GameBoard from '../components/GameBoard'
import PlayerBadge from '../components/PlayerBadge'
import BetDisplay from '../components/BetDisplay'
import MoveLog from '../components/MoveLog'
import { broadcastGameState, registerIdentityKey } from '../lib/api'
import { signer } from '../lib/wallet'
import { provider, artifact, estimateFee, pubkeyToPKH } from '../lib/wallet-provider'
import { TicTacToeContract } from '../generated/TicTacToeContract'
import { analyzeMove } from '../lib/game-logic'
import { STATUS_LABELS } from '../lib/types'
import type { Game } from '../lib/types'

/** Load the on-chain contract from local game state (no network call needed). */
function loadGameContract(game: Game) {
  const contract = TicTacToeContract.fromUtxo(artifact, {
    txid: game.txid,
    outputIndex: game.outputIndex,
    satoshis: game.satoshis,
    script: game.lockingScript,
  })
  contract.connect(provider, signer)
  return contract
}

export default function GamePage() {
  const { id } = useParams<{ id: string }>()
  const { game, loading, error, setGame } = useGame(id)
  const { connected } = useWallet()
  const { derivedKey, identityKey } = useDerivedKey()
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')
  const [winLine, setWinLine] = useState<number[] | null>(null)

  const isPlayerX = game?.playerX === derivedKey
  const isPlayerO = game?.playerO === derivedKey
  const isMyTurn = game?.status === 1 && (
    (game.turn === 1 && isPlayerX) || (game.turn === 2 && isPlayerO)
  )

  const cancel = useCancelFlow(game, derivedKey, identityKey, isPlayerX, isPlayerO, setGame, id)

  // Register identity key with overlay when we know both game and identity
  useEffect(() => {
    if (!game || !derivedKey || !identityKey) return
    const isPlayer = game.playerX === derivedKey || game.playerO === derivedKey
    if (!isPlayer) return
    registerIdentityKey(game.txid, derivedKey, identityKey).catch(console.error)
  }, [game?.txid, derivedKey, identityKey])

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

      const fee = estimateFee()
      const changePKH = pubkeyToPKH(derivedKey)

      const contract = loadGameContract(game)
      let txid: string
      let newSatoshis = game.satoshis

      if (moveResult.method === 'moveAndWin') {
        // Fund fee + change buffer; the contract returns the buffer to our wallet
        await provider.ensureFunding(fee * 2)
        const result = await contract.moveAndWin(BigInt(index), null, changePKH, BigInt(fee), [
          { address: moveResult.winnerPubkey!, satoshis: game.betAmount * 2 },
        ])
        txid = result.txid
        newSatoshis = 0
      } else if (moveResult.method === 'moveAndTie') {
        await provider.ensureFunding(fee * 2)
        const result = await contract.moveAndTie(BigInt(index), null, changePKH, BigInt(fee), [
          { address: moveResult.playerX!, satoshis: game.betAmount },
          { address: moveResult.playerO!, satoshis: game.betAmount },
        ])
        txid = result.txid
        newSatoshis = 0
      } else {
        const result = await contract.move(BigInt(index), null, {
          satoshis: game.satoshis,
        })
        txid = result.txid
      }

      // Build the new game state
      const newBoard = game.board.split('')
      newBoard[index] = String(game.turn)
      const newStatus = moveResult.method === 'moveAndWin'
        ? (game.turn === 1 ? 2 : 3)
        : moveResult.method === 'moveAndTie' ? 4 : 1
      const newGame: Game = {
        ...game,
        txid,
        outputIndex: 0,
        board: newBoard.join(''),
        turn: game.turn === 1 ? 2 : 1,
        status: newStatus,
        satoshis: newSatoshis,
        updatedAt: new Date().toISOString(),
      }

      if (moveResult.winLine) setWinLine(moveResult.winLine)

      // Broadcast to SSE subscribers and update local state
      await broadcastGameState(id!, newGame)
      setGame(newGame)
    } catch (err: any) {
      console.error('[move]', err)
      setActionError('Failed to make move')
    } finally {
      setActionLoading(false)
    }
  }, [game, isMyTurn, actionLoading, derivedKey, setGame, id])

  const handleJoin = useCallback(async () => {
    if (!game || !connected || !derivedKey || isPlayerX) return

    setActionLoading(true)
    setActionError('')

    try {
      await provider.ensureFunding(game.betAmount + estimateFee())
      const contract = loadGameContract(game)
      const result = await contract.join(null, { satoshis: game.betAmount * 2 })

      const newGame: Game = {
        ...game,
        txid: result.txid,
        outputIndex: 0,
        playerO: derivedKey,
        status: 1,
        satoshis: game.betAmount * 2,
        updatedAt: new Date().toISOString(),
      }

      await broadcastGameState(id!, newGame)
      setGame(newGame)

      if (identityKey) {
        registerIdentityKey(result.txid, derivedKey, identityKey).catch(console.error)
      }
    } catch (err: any) {
      console.error('[join]', err)
      setActionError('Failed to join game')
    } finally {
      setActionLoading(false)
    }
  }, [game, connected, derivedKey, isPlayerX, identityKey, setGame, id])

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-dim)' }}>Loading game...</div>
  }

  if (error || !game) {
    return <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-error)' }}>{error || 'Game not found'}</div>
  }

  const gameOver = game.status >= 2
  const anyLoading = actionLoading || cancel.cancelLoading
  const anyError = actionError || cancel.cancelError

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
          {STATUS_LABELS[game.status]}
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
        <GameBoard board={game.board} onCellClick={handleCellClick} disabled={!isMyTurn || anyLoading || gameOver} winLine={winLine} />
        {anyLoading && (
          <div style={{ textAlign: 'center', marginTop: 16, color: 'var(--color-text-dim)', fontSize: 13 }}>Processing...</div>
        )}
        {anyError && (
          <div style={{ textAlign: 'center', marginTop: 16, color: 'var(--color-error)', fontSize: 13 }}>{anyError}</div>
        )}
      </div>

      {game.status === 0 && connected && derivedKey && !isPlayerX && (
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <button className="btn-primary" style={{ padding: '14px 32px', fontSize: 16 }} onClick={handleJoin} disabled={anyLoading}>
            {anyLoading ? 'Joining...' : `Accept Challenge (${game.betAmount.toLocaleString()} sats)`}
          </button>
        </div>
      )}

      {game.status === 0 && isPlayerX && (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--color-text-dim)', fontSize: 14, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', marginBottom: 24 }}>
          Waiting for an opponent to join...
          <div style={{ marginTop: 8, fontSize: 12 }}>
            Share this URL: <code style={{ color: 'var(--color-accent)' }}>{window.location.href}</code>
          </div>
          <button className="btn-secondary" style={{ marginTop: 16, fontSize: 13 }} onClick={cancel.handleCancel} disabled={anyLoading}>
            {anyLoading ? 'Cancelling...' : 'Cancel Game'}
          </button>
        </div>
      )}

      {game.status === 1 && !gameOver && (
        <div style={{ textAlign: 'center', padding: 12, fontSize: 14, color: isMyTurn ? 'var(--color-accent)' : 'var(--color-text-dim)', fontWeight: isMyTurn ? 600 : 400 }}>
          {isMyTurn ? 'Your turn!' : "Opponent's turn..."}
        </div>
      )}

      {game.status === 1 && connected && (isPlayerX || isPlayerO) && (() => {
        if (cancel.cancelProposal?.type === 'propose') {
          return (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 13, marginBottom: 8, color: 'var(--color-accent)' }}>Opponent wants to cancel the game</div>
              <button className="btn-primary" style={{ fontSize: 13, padding: '8px 20px' }} onClick={cancel.handleApproveCancel} disabled={anyLoading}>
                {anyLoading ? 'Processing...' : 'Approve Cancel'}
              </button>
            </div>
          )
        }
        if (cancel.cancelProposal?.type === 'approve' && cancel.cancelProposal.signature) {
          return (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 13, marginBottom: 8, color: 'var(--color-accent)' }}>Opponent approved cancel. Sign to complete:</div>
              <button className="btn-primary" style={{ fontSize: 13, padding: '8px 20px' }} onClick={cancel.handleSignCancel} disabled={anyLoading}>
                {anyLoading ? 'Signing...' : 'Sign Cancel'}
              </button>
            </div>
          )
        }
        if (cancel.cancelProposed) {
          return <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 13, color: 'var(--color-text-dim)' }}>Cancel proposed. Waiting for opponent to respond...</div>
        }
        return (
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <button className="btn-secondary" style={{ fontSize: 12, padding: '6px 16px' }} onClick={cancel.handleProposeCancel} disabled={anyLoading}>
              Propose Cancel
            </button>
          </div>
        )
      })()}

      <div className="card" style={{ padding: 16 }}>
        <MoveLog game={game} />
      </div>

      <div style={{ marginTop: 16, fontSize: 11, color: 'var(--color-text-dim)', textAlign: 'center', wordBreak: 'break-all' }}>
        Game: {id}
        <br />
        Current TX: {game.txid}
      </div>
    </div>
  )
}
