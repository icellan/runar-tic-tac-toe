import { useState, useEffect } from 'react'
import { useWallet } from '../hooks/useWallet'
import { useMyGameList } from '../hooks/useGameList'
import GameList from '../components/GameList'
import { getDerivedPubKey } from '../lib/wallet'

export default function MyGamesPage() {
  const { connected, pubkey } = useWallet()
  const [derivedKey, setDerivedKey] = useState('')
  useEffect(() => {
    if (connected) getDerivedPubKey().then(setDerivedKey).catch(() => {})
  }, [connected])
  // Query with derived key (new games) — backend also checks identity key for legacy
  const { games, loading } = useMyGameList(derivedKey || pubkey)

  if (!connected) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <h2 style={{ marginBottom: 12, fontSize: 20 }}>My Games</h2>
        <p style={{ color: 'var(--color-text-dim)' }}>
          Connect your BRC-100 wallet to see your games
        </p>
      </div>
    )
  }

  const activeGames = games.filter(g => g.status <= 1)
  const completedGames = games.filter(g => g.status >= 2)

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>My Games</h1>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-dim)' }}>Loading...</div>
      ) : (
        <>
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 16, marginBottom: 12, color: 'var(--color-text-dim)' }}>
              Active ({activeGames.length})
            </h2>
            <GameList games={activeGames} emptyMessage="No active games" />
          </div>

          <div>
            <h2 style={{ fontSize: 16, marginBottom: 12, color: 'var(--color-text-dim)' }}>
              Completed ({completedGames.length})
            </h2>
            <GameList games={completedGames} emptyMessage="No completed games" />
          </div>
        </>
      )}
    </div>
  )
}
