import type { Game } from '../lib/types'

interface MoveLogProps {
  game: Game
}

export default function MoveLog({ game }: MoveLogProps) {
  const board = game.board.split('').map(Number)
  const moves: { position: number; player: string; mark: string }[] = []

  // Reconstruct move order from board (X always goes first)
  // We can't know exact order from state alone, but we can show the current board state
  for (let i = 0; i < 9; i++) {
    if (board[i] === 1) {
      moves.push({ position: i, player: 'X', mark: 'X' })
    } else if (board[i] === 2) {
      moves.push({ position: i, player: 'O', mark: 'O' })
    }
  }

  if (moves.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--color-text-dim)', padding: '12px 0' }}>
        No moves yet
      </div>
    )
  }

  const posLabel = (pos: number) => {
    const rows = ['top', 'mid', 'bot']
    const cols = ['left', 'center', 'right']
    return `${rows[Math.floor(pos / 3)]}-${cols[pos % 3]}`
  }

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ color: 'var(--color-text-dim)', marginBottom: 8, fontSize: 12 }}>Board State</div>
      {moves.map((m, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '4px 0',
          color: m.mark === 'X' ? 'var(--color-x)' : 'var(--color-o)',
        }}>
          <span style={{ fontWeight: 600, width: 16 }}>{m.mark}</span>
          <span style={{ color: 'var(--color-text-dim)' }}>{posLabel(m.position)}</span>
        </div>
      ))}
    </div>
  )
}
