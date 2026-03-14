interface BetDisplayProps {
  betAmount: number
  status: number
}

export default function BetDisplay({ betAmount, status }: BetDisplayProps) {
  const potAmount = status >= 1 ? betAmount * 2 : betAmount
  const label = status === 0 ? 'Stake' : 'Pot'

  return (
    <div style={{
      textAlign: 'center',
      padding: '12px 20px',
      background: 'var(--bg-secondary)',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--color-border)',
    }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-accent)' }}>
        {potAmount.toLocaleString()} <span style={{ fontSize: 12, fontWeight: 400 }}>sats</span>
      </div>
    </div>
  )
}
