interface BetDisplayProps {
  betAmount: number
  status: number
}

export default function BetDisplay({ betAmount, status }: BetDisplayProps) {
  const potAmount = status >= 1 ? betAmount * 2 : betAmount
  const label = status === 0 ? 'STAKE' : 'POT'
  const isLive = status === 1

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 24px',
      background: isLive
        ? 'linear-gradient(135deg, rgba(255, 224, 64, 0.08) 0%, rgba(255, 82, 82, 0.04) 100%)'
        : 'var(--bg-secondary)',
      borderRadius: 'var(--radius-sm)',
      border: isLive ? '1px solid rgba(255, 224, 64, 0.2)' : '1px solid var(--color-border)',
    }}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.12em',
        color: 'var(--color-text-dim)',
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 24,
        fontWeight: 700,
        color: 'var(--color-accent)',
        textShadow: isLive ? '0 0 12px rgba(255, 224, 64, 0.3)' : 'none',
        lineHeight: 1,
      }}>
        {potAmount.toLocaleString()}
        <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 4, color: 'var(--color-text-dim)', letterSpacing: '0.05em' }}>sats</span>
      </div>
    </div>
  )
}
