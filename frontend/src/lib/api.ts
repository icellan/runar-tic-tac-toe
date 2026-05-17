import { signEnvelope } from 'runar-sdk'
import { signer } from './wallet'
import { OVERLAY_URL } from './wallet-provider'
import type { Game, BroadcastResponse } from './types'

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

export async function broadcastGameState(roomId: string, game: Game): Promise<BroadcastResponse> {
  const envelope = await signEnvelope({
    data: { roomId, game: game as unknown as Record<string, unknown> },
    signer,
  })
  return fetchJSON(`/api/games/${roomId}/broadcast`, {
    method: 'POST',
    body: JSON.stringify(envelope),
  })
}

export async function registerIdentityKey(txid: string, derivedPubkey: string, identityKey: string): Promise<void> {
  const resp = await fetch(`${OVERLAY_URL}/api/identity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txid, derivedPubkey, identityKey }),
  })
  if (!resp.ok) console.warn('[registerIdentityKey] failed:', resp.status)
}
