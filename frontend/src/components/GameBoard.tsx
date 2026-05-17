import GameCell from './GameCell'
import WinLine from './WinLine'

interface GameBoardProps {
  board: string // "000000000"
  onCellClick: (index: number) => void
  disabled: boolean
  winLine: number[] | null
}

export default function GameBoard({ board, onCellClick, disabled, winLine }: GameBoardProps) {
  const cells = board.split('').map(Number)

  return (
    <svg
      viewBox="0 0 300 300"
      width="300"
      height="300"
      style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }}
    >
      <style>{`
        .cell-hover:hover { fill: rgba(255, 255, 255, 0.04); }
        .cell-hover { transition: fill 0.15s; }
      `}</style>

      {/* Grid lines with subtle glow */}
      <line x1={100} y1={8} x2={100} y2={292} stroke="var(--color-border)" strokeWidth={2} strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 3px rgba(37, 37, 69, 0.8))' }} />
      <line x1={200} y1={8} x2={200} y2={292} stroke="var(--color-border)" strokeWidth={2} strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 3px rgba(37, 37, 69, 0.8))' }} />
      <line x1={8} y1={100} x2={292} y2={100} stroke="var(--color-border)" strokeWidth={2} strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 3px rgba(37, 37, 69, 0.8))' }} />
      <line x1={8} y1={200} x2={292} y2={200} stroke="var(--color-border)" strokeWidth={2} strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 3px rgba(37, 37, 69, 0.8))' }} />

      {/* Cells */}
      {cells.map((value, index) => (
        <GameCell
          key={index}
          index={index}
          value={value}
          onClick={onCellClick}
          disabled={disabled}
          isWinning={winLine ? winLine.includes(index) : false}
        />
      ))}

      {/* Win line overlay */}
      {winLine && <WinLine line={winLine} />}
    </svg>
  )
}
