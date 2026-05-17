interface PlayerBadgeProps {
  label: string
  pubkey: string
  isCurrentTurn: boolean
  mark: 'X' | 'O'
}

export default function PlayerBadge({ label, pubkey, isCurrentTurn, mark }: PlayerBadgeProps) {
  const color = mark === 'X' ? 'var(--color-x)' : 'var(--color-o)'
  const glow = mark === 'X' ? 'var(--glow-x)' : 'var(--glow-o)'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 14px',
      overflow: 'hidden',
      borderRadius: 'var(--radius-sm)',
      background: isCurrentTurn ? 'rgba(255, 224, 64, 0.06)' : 'var(--bg-secondary)',
      border: isCurrentTurn ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
      transition: 'all 0.3s ease',
      animation: isCurrentTurn ? 'pulseGlow 2s ease-in-out infinite' : 'none',
    }}>
      <span style={{
        width: 36, height: 36,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-display)',
        fontWeight: 700, fontSize: 18, color,
        background: `${color}18`,
        borderRadius: 8,
        boxShadow: isCurrentTurn ? glow : 'none',
        transition: 'box-shadow 0.3s',
      }}>
        {mark}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pubkey ? `${pubkey.slice(0, 8)}...${pubkey.slice(-6)}` : 'Waiting...'}
        </div>
      </div>
      {isCurrentTurn && (
        <span style={{
          marginLeft: 'auto',
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: 'var(--color-accent)',
          textShadow: '0 0 8px rgba(255, 224, 64, 0.5)',
        }}>
          TURN
        </span>
      )}
    </div>
  )
}
