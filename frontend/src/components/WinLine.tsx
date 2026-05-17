interface WinLineProps {
  line: number[] // 3 cell indices
}

function cellCenter(index: number): [number, number] {
  const col = index % 3
  const row = Math.floor(index / 3)
  return [col * 100 + 50, row * 100 + 50]
}

export default function WinLine({ line }: WinLineProps) {
  if (line.length < 3) return null

  const [x1, y1] = cellCenter(line[0])
  const [x2, y2] = cellCenter(line[2])

  return (
    <line
      x1={x1} y1={y1}
      x2={x2} y2={y2}
      stroke="var(--color-accent)"
      strokeWidth={5}
      strokeLinecap="round"
      strokeDasharray="500"
      style={{
        animation: 'drawLine 0.5s ease-out forwards, glowBurst 1s ease-out 0.4s',
        filter: 'drop-shadow(0 0 10px var(--color-accent)) drop-shadow(0 0 20px rgba(255, 224, 64, 0.2))',
      }}
    />
  )
}
