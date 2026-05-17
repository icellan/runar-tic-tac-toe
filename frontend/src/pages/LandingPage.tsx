import { useState } from 'react'
import { useGameList } from '../hooks/useGameList'
import GameList from '../components/GameList'
import CreateGameModal from '../components/CreateGameModal'

export default function LandingPage() {
  const { games, loading } = useGameList()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 28,
      }}>
        <div>
          <h1 style={{ fontSize: 26, marginBottom: 4, letterSpacing: '0.01em' }}>Open Challenges</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-dim)' }}>
            Join a game or create your own
          </p>
        </div>
        <button className="btn-primary" style={{ fontSize: 15, padding: '12px 24px' }} onClick={() => setShowCreate(true)}>
          New Game
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-dim)', fontSize: 14 }}>
          Loading...
        </div>
      ) : (
        <GameList games={games} emptyMessage="No open games. Be the first to create one!" />
      )}

      <CreateGameModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  )
}
