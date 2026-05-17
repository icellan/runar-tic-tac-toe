import { useCallback } from 'react'
import { usePolledList } from 'runar-react'
import { listGames, listMyGames } from '../lib/api'
import type { Game } from '../lib/types'

/**
 * Fetch and poll game lists.
 * Without a pubkey: returns open/public games.
 * With a pubkey: returns games for that player.
 */
export function useGameList(pubkey?: string) {
  const fetchList = useCallback(async (): Promise<Game[]> => {
    if (pubkey === undefined) return listGames()
    if (!pubkey) return []
    return listMyGames(pubkey)
  }, [pubkey])
  const { data, loading, refresh } = usePolledList<Game>({ fetchList, intervalMs: 5000 })
  return { games: data, loading, refresh }
}
