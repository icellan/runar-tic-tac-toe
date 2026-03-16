import type { Game, BroadcastResponse } from './types'
import { OVERLAY_URL } from './wallet-provider'

async function fetchJSON<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(OVERLAY_URL + url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || res.statusText)
  }
  return res.json()
}

export async function listGames(): Promise<Game[]> {
  return fetchJSON('/api/games')
}

export async function listMyGames(pubkey: string): Promise<Game[]> {
  return fetchJSON(`/api/games/by-player/${encodeURIComponent(pubkey)}`)
}

export async function getGame(id: string): Promise<Game> {
  return fetchJSON(`/api/games/${id}`)
}

/** Broadcast game state to SSE subscribers via the overlay */
export async function broadcastGameState(roomId: string, game: Game): Promise<BroadcastResponse> {
  return fetchJSON(`/api/games/${roomId}/broadcast`, {
    method: 'POST',
    body: JSON.stringify(game),
  })
}

/** Register identity key with the overlay for MessageBox cancel flow */
export async function registerIdentityKey(txid: string, derivedPubkey: string, identityKey: string): Promise<void> {
  const resp = await fetch(`${OVERLAY_URL}/api/identity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txid, derivedPubkey, identityKey }),
  })
  if (!resp.ok) {
    console.warn('[registerIdentityKey] failed:', resp.status)
  }
}
