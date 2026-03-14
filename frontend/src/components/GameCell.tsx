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

  return (
    <g
      onClick={() => !disabled && value === 0 && onClick(index)}
      style={{ cursor: !disabled && value === 0 ? 'pointer' : 'default' }}
    >
      {/* Cell background (hover effect) */}
      <rect
        x={x + 2} y={y + 2}
        width={96} height={96}
        rx={8}
        fill={isWinning ? 'rgba(255, 217, 61, 0.1)' : 'transparent'}
        className={!disabled && value === 0 ? 'cell-hover' : ''}
      />

      {/* X mark */}
      {value === 1 && (
        <g style={{ animation: 'scaleIn 0.3s ease-out' }}>
          <line
            x1={cx - 25} y1={cy - 25}
            x2={cx + 25} y2={cy + 25}
            stroke="var(--color-x)"
            strokeWidth={6}
            strokeLinecap="round"
          />
          <line
            x1={cx + 25} y1={cy - 25}
            x2={cx - 25} y2={cy + 25}
            stroke="var(--color-x)"
            strokeWidth={6}
            strokeLinecap="round"
          />
        </g>
      )}

      {/* O mark */}
      {value === 2 && (
        <circle
          cx={cx} cy={cy} r={28}
          fill="none"
          stroke="var(--color-o)"
          strokeWidth={6}
          strokeLinecap="round"
          style={{ animation: 'scaleIn 0.3s ease-out' }}
        />
      )}
    </g>
  )
}
