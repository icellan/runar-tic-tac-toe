import { Link } from 'react-router-dom'
import type { Game } from '../lib/types'
import { STATUS_LABELS } from '../lib/types'

interface GameCardProps {
  game: Game
}

function MiniBoard({ board }: { board: string }) {
  const cells = board.split('').map(Number)
  return (
    <svg viewBox="0 0 60 60" width={60} height={60}>
      {/* Grid */}
      <line x1={20} y1={2} x2={20} y2={58} stroke="var(--color-border)" strokeWidth={1} />
      <line x1={40} y1={2} x2={40} y2={58} stroke="var(--color-border)" strokeWidth={1} />
      <line x1={2} y1={20} x2={58} y2={20} stroke="var(--color-border)" strokeWidth={1} />
      <line x1={2} y1={40} x2={58} y2={40} stroke="var(--color-border)" strokeWidth={1} />
      {cells.map((v, i) => {
        const cx = (i % 3) * 20 + 10
        const cy = Math.floor(i / 3) * 20 + 10
        if (v === 1) return (
          <g key={i}>
            <line x1={cx-5} y1={cy-5} x2={cx+5} y2={cy+5} stroke="var(--color-x)" strokeWidth={2} strokeLinecap="round" />
            <line x1={cx+5} y1={cy-5} x2={cx-5} y2={cy+5} stroke="var(--color-x)" strokeWidth={2} strokeLinecap="round" />
          </g>
        )
        if (v === 2) return (
          <circle key={i} cx={cx} cy={cy} r={6} fill="none" stroke="var(--color-o)" strokeWidth={2} />
        )
        return null
      })}
    </svg>
  )
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const secs = Math.floor((now - then) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function statusBadgeClass(status: number): string {
  if (status === 0) return 'badge badge-waiting'
  if (status === 1) return 'badge badge-playing'
  return 'badge badge-ended'
}

export default function GameCard({ game }: GameCardProps) {
  return (
    <Link to={`/game/${game.gameId}`} style={{ textDecoration: 'none' }}>
      <div className="card" style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        transition: 'background 0.2s',
        cursor: 'pointer',
      }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-card)')}
      >
        <MiniBoard board={game.board} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className={statusBadgeClass(game.status)}>
              {STATUS_LABELS[game.status]}
            </span>
            <span style={{ color: 'var(--color-accent)', fontSize: 13, fontWeight: 600 }}>
              {game.betAmount.toLocaleString()} sats
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>
            {game.gameId.slice(0, 12)}...
            {game.createdAt && (
              <span style={{ marginLeft: 8 }}>{timeAgo(game.createdAt)}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}
