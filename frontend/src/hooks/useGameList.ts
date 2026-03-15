import { useState, useEffect, useCallback } from 'react'
import type { Game } from '../lib/types'
import { listGames, listMyGames } from '../lib/api'

/**
 * Fetch and poll game lists.
 * Without a pubkey: returns open/public games.
 * With a pubkey: returns games for that player.
 */
export function useGameList(pubkey?: string) {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (pubkey !== undefined && !pubkey) {
      setGames([])
      setLoading(false)
      return
    }
    try {
      const g = pubkey ? await listMyGames(pubkey) : await listGames()
      setGames(g)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [pubkey])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh])

  return { games, loading, refresh }
}
