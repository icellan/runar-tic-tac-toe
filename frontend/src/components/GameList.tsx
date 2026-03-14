import type { Game } from '../lib/types'
import GameCard from './GameCard'

interface GameListProps {
  games: Game[]
  emptyMessage: string
}

export default function GameList({ games, emptyMessage }: GameListProps) {
  if (games.length === 0) {
    return (
      <div style={{
        textAlign: 'center',
        padding: 40,
        color: 'var(--color-text-dim)',
        fontSize: 14,
      }}>
        {emptyMessage}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {games.map(game => (
        <GameCard key={game.gameId} game={game} />
      ))}
    </div>
  )
}
