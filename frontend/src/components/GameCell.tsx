interface GameCellProps {
  index: number
  value: number // 0=empty, 1=X, 2=O
  onClick: (index: number) => void
  disabled: boolean
  isWinning: boolean
}

export default function GameCell({ index, value, onClick, disabled, isWinning }: GameCellProps) {
  const col = index % 3
  const row = Math.floor(index / 3)
  const x = col * 100
  const y = row * 100
  const cx = x + 50
  const cy = y + 50
  const clickable = !disabled && value === 0

  return (
    <g
      onClick={() => clickable && onClick(index)}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
    >
      {/* Cell background */}
      <rect
        x={x + 2} y={y + 2}
        width={96} height={96}
        rx={8}
        fill={isWinning ? 'rgba(255, 224, 64, 0.08)' : 'transparent'}
        className={clickable ? 'cell-hover' : ''}
      />

      {/* X mark — draw-in animation with glow */}
      {value === 1 && (
        <g
          style={{ filter: isWinning ? 'drop-shadow(0 0 8px var(--color-x))' : 'none' }}
        >
          <line
            x1={cx - 24} y1={cy - 24}
            x2={cx + 24} y2={cy + 24}
            stroke="var(--color-x)"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray="80"
            style={{ animation: 'drawX 0.35s ease-out forwards' }}
          />
          <line
            x1={cx + 24} y1={cy - 24}
            x2={cx - 24} y2={cy + 24}
            stroke="var(--color-x)"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray="80"
            style={{ animation: 'drawX 0.35s ease-out 0.08s forwards', opacity: 0 }}
          />
        </g>
      )}

      {/* O mark — draw-in animation with glow */}
      {value === 2 && (
        <circle
          cx={cx} cy={cy} r={28}
          fill="none"
          stroke="var(--color-o)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray="176"
          style={{
            animation: 'drawO 0.4s ease-out forwards',
            filter: isWinning ? 'drop-shadow(0 0 8px var(--color-o))' : 'none',
          }}
        />
      )}
    </g>
  )
}
