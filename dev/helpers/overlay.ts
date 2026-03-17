/**
 * Overlay helpers — submit transactions and query the overlay REST API.
 */

export const OVERLAY_URL = process.env.OVERLAY_URL ?? 'http://localhost:8081';

/** Submit a transaction to the overlay for indexing via /dev/submit (regtest mode). */
export async function submitToOverlay(txHex: string) {
  const resp = await fetch(`${OVERLAY_URL}/dev/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txHex }),
  });
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error(`Overlay submit failed (${resp.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

/** Broadcast game state to overlay REST API (same path the frontend uses). */
export async function broadcastGameState(roomId: string, game: Record<string, unknown>) {
  const resp = await fetch(`${OVERLAY_URL}/api/games/${roomId}/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(game),
  });
  return resp.json();
}

/** Query a game from the overlay REST API. */
export async function getGame(txid: string) {
  const resp = await fetch(`${OVERLAY_URL}/api/games/${txid}`);
  if (!resp.ok) return null;
  return resp.json();
}

/** List open games from the overlay. */
export async function listGames() {
  const resp = await fetch(`${OVERLAY_URL}/api/games`);
  return resp.json();
}

/** Get raw transaction hex from the overlay. */
export async function getTxHex(txid: string): Promise<string | null> {
  const resp = await fetch(`${OVERLAY_URL}/api/tx/${txid}/hex`);
  if (!resp.ok) return null;
  return resp.text();
}
