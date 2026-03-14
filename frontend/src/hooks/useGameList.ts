import { useState, useEffect, useCallback } from 'react'
import type { Game } from '../lib/types'
import { listGames, listMyGames } from '../lib/api'

export function useGameList() {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const g = await listGames()
      setGames(g)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh])

  return { games, loading, refresh }
}

export function useMyGameList(pubkey: string) {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!pubkey) {
      setGames([])
      setLoading(false)
      return
    }
    try {
      const g = await listMyGames(pubkey)
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
