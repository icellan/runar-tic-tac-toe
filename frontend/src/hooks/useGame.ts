import { useLocation } from 'react-router-dom'
import { useSubscribedRecord } from 'runar-react'
import { getGame } from '../lib/api'
import { OVERLAY_URL } from '../lib/wallet-provider'
import type { Game } from '../lib/types'

export function useGame(gameId: string | undefined) {
  const location = useLocation()
  const initialGame = (location.state as any)?.game as Game | undefined
  const { data, loading, error, setData } = useSubscribedRecord<Game>({
    id: gameId,
    fetchOne: getGame,
    sseUrl: id => `${OVERLAY_URL}/api/games/${id}/events`,
    initial: initialGame,
  })
  return { game: data, loading, error, setGame: setData }
}
