import type { Game, BroadcastResponse } from './types'

const BASE = '/api'
const OVERLAY_URL = 'http://localhost:8081'

async function fetchJSON<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
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
  return fetchJSON('/games')
}

export async function listMyGames(pubkey: string): Promise<Game[]> {
  return fetchJSON(`/games/mine?pubkey=${encodeURIComponent(pubkey)}`)
}

export async function getGame(id: string): Promise<Game> {
  return fetchJSON(`/games/${id}`)
}

/** Record a completed action (after wallet broadcasts) and relay via SSE */
export async function recordAction(id: string, txid: string, action: string, extra?: Record<string, unknown>): Promise<BroadcastResponse> {
  return fetchJSON(`/games/${id}/broadcast`, {
    method: 'POST',
    body: JSON.stringify({ txid, action, ...extra }),
  })
}

/** Get contract UTXO info for building spending transactions */
export async function prepareSpend(id: string): Promise<{
  contractTxid: string
  contractVout: number
  contractSatoshis: number
  lockingScript: string
  betAmount: number
  playerX: string
  playerO: string
}> {
  return fetchJSON(`/games/${id}/prepare`)
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

/** Get opponent's identity key from the overlay game data */
export async function getOpponentIdentityKey(gameId: string, myDerivedPubkey: string): Promise<string | null> {
  const game = await getGame(gameId)
  if (!game) return null
  // Determine which player I am and return the opponent's identity key
  const isPlayerX = game.playerX === myDerivedPubkey
  const key = isPlayerX ? (game as any).identityKeyO : (game as any).identityKeyX
  return key || null
}
