import { useState, useEffect, useRef } from 'react'
import type { Game } from '../lib/types'
import { getGame } from '../lib/api'

export function useGame(gameId: string | undefined) {
  const [game, setGame] = useState<Game | null>(null)
  const [loading, setLoading] = useState(true)
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
      } catch (err: any) {
        console.error('[load-game]', err)
        if (!cancelled) {
          setError('Failed to load game')
          setLoading(false)
        }
      }
    }

    load()

    // Subscribe to SSE for live updates
    const es = new EventSource(`/api/games/${gameId}/events`)
    eventSourceRef.current = es

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (!cancelled) {
          setGame(data)
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
