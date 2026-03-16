import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import type { Game } from '../lib/types'
import { getGame } from '../lib/api'
import { OVERLAY_URL } from '../lib/wallet-provider'

export function useGame(gameId: string | undefined) {
  const location = useLocation()
  const initialGame = (location.state as any)?.game as Game | undefined
  const [game, setGame] = useState<Game | null>(initialGame ?? null)
  const [loading, setLoading] = useState(!initialGame)
  const [error, setError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!gameId) return

    let cancelled = false

    async function load() {
      try {
        const g = await getGame(gameId!)
        if (!cancelled) {
          setGame(g)
          setLoading(false)
        }
      } catch {
        // Game may not be indexed yet (e.g., just created). SSE or
        // navigation state will provide the data, so don't treat as fatal.
      }
    }

    // Only fetch if we don't already have the game from navigation state
    if (!initialGame) {
      load()
    }

    // Subscribe to SSE for live updates
    const es = new EventSource(`${OVERLAY_URL}/api/games/${gameId}/events`)
    eventSourceRef.current = es

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (!cancelled) {
          setGame(data)
          setLoading(false)
          setError(null)
        }
      } catch {
        // ignore parse errors
      }
    }

    es.onerror = () => {
      // EventSource will auto-reconnect
    }

    return () => {
      cancelled = true
      es.close()
      eventSourceRef.current = null
    }
  }, [gameId])

  return { game, loading, error, setGame }
}
