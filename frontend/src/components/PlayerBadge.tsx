interface PlayerBadgeProps {
  label: string
  pubkey: string
  isCurrentTurn: boolean
  mark: 'X' | 'O'
}

export default function PlayerBadge({ label, pubkey, isCurrentTurn, mark }: PlayerBadgeProps) {
  const color = mark === 'X' ? 'var(--color-x)' : 'var(--color-o)'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      overflow: 'hidden',
      borderRadius: 'var(--radius-sm)',
      background: isCurrentTurn ? 'rgba(255, 217, 61, 0.08)' : 'transparent',
      border: isCurrentTurn ? '1px solid var(--color-accent)' : '1px solid transparent',
      transition: 'all 0.3s',
    }}>
      <span style={{
        width: 32, height: 32,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: 18, color,
        background: `${color}22`,
        borderRadius: 6,
      }}>
        {mark}
      </span>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>
          {pubkey ? `${pubkey.slice(0, 8)}...${pubkey.slice(-6)}` : 'Waiting...'}
        </div>
      </div>
      {isCurrentTurn && (
        <span style={{
          marginLeft: 'auto',
          fontSize: 11,
          color: 'var(--color-accent)',
          fontWeight: 600,
        }}>
          TURN
        </span>
      )}
    </div>
  )
}
