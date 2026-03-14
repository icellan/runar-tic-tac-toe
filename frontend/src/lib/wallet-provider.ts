/**
 * WalletProvider — Provider that uses:
 *   - BRC-100 wallet for UTXO management (game basket)
 *   - Local tx cache + overlay for raw tx data (EF parent lookups)
 *   - GorillaPool ARC for broadcast (EF format)
 *   - Overlay for tx submission / indexing
 *
 * No WhatsOnChain dependency — all data comes from wallet, overlay, or cache.
 */
import type { Provider, UTXO, TransactionData, TxInput, TxOutput } from 'runar-sdk'
import { buildP2PKHScript } from 'runar-sdk'
import { wallet, signer } from './wallet'
import { Transaction, Utils } from '@bsv/sdk'

const ARC_BASE = 'https://arc.gorillapool.io'
const OVERLAY_URL = 'http://localhost:8081'
const GAME_BASKET = 'tic-tac-toe'
const FUNDING_TAG = 'funding'

// ---------------------------------------------------------------------------
// Transaction cache — needed for EF format (parent tx embedding)
// ---------------------------------------------------------------------------

const txCache = new Map<string, string>()

/** Cache a raw tx hex by its txid */
export function cacheTx(txid: string, rawHex: string): void {
  txCache.set(txid, rawHex)
}

/** Fetch raw tx hex: local cache first, then overlay */
async function fetchRawTx(txid: string): Promise<string> {
  const cached = txCache.get(txid)
  if (cached) return cached

  // Try the overlay's raw tx endpoint
  const resp = await fetch(`${OVERLAY_URL}/api/tx/${txid}/hex`)
  if (resp.ok) {
    const hex = (await resp.text()).trim()
    txCache.set(txid, hex)
    return hex
  }

  throw new Error(`Could not fetch parent tx ${txid}: not in cache, overlay returned ${resp.status}`)
}

// ---------------------------------------------------------------------------
// Broadcast — ARC with EF format + overlay submission
// ---------------------------------------------------------------------------

async function broadcastTx(tx: Transaction): Promise<string> {
  // Ensure source transactions are attached for EF format
  for (const input of tx.inputs) {
    if (input.sourceTransaction) continue
    const parentTxid = input.sourceTXID
    if (!parentTxid) continue
    const parentHex = await fetchRawTx(parentTxid)
    input.sourceTransaction = Transaction.fromHex(parentHex)
  }

  const efBytes = tx.toEFUint8Array()
  console.log('[broadcast] sending EF format,', efBytes.length, 'bytes')

  const resp = await fetch(`${ARC_BASE}/v1/tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: efBytes.buffer as ArrayBuffer,
  })
  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`ARC broadcast failed (${resp.status}): ${body}`)
  }
  const result = await resp.json()
  const txid = result.txid

  // Cache for future EF lookups
  txCache.set(txid, tx.toHex())

  // Fire-and-forget: submit to overlay for indexing
  submitToOverlay(tx).catch(err =>
    console.warn('[broadcast] overlay submit failed (non-fatal):', err)
  )

  return txid
}

async function broadcastToARC(rawTx: string): Promise<string> {
  const tx = Transaction.fromHex(rawTx)
  return broadcastTx(tx)
}

async function submitToOverlay(tx: Transaction): Promise<void> {
  const beef = tx.toBEEF()
  const resp = await fetch(`${OVERLAY_URL}/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Topics': JSON.stringify(['tm_tictactoe']),
    },
    body: JSON.stringify({
      beef: Array.from(beef),
      topics: ['tm_tictactoe'],
    }),
  })
  if (resp.ok) {
    console.log('[overlay] submitted tx to overlay')
  } else {
    console.warn('[overlay] submit failed:', resp.status, await resp.text().catch(() => ''))
  }
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export class WalletProvider implements Provider {
  /**
   * Get UTXOs from the wallet's game basket.
   * Returns only P2PKH UTXOs locked to the signer's derived key.
   */
  async getUtxos(_address: string): Promise<UTXO[]> {
    const result = await wallet.listOutputs({
      basket: GAME_BASKET,
      tags: [FUNDING_TAG],
      tagQueryMode: 'all',
      include: 'locking scripts',
      limit: 100,
      seekPermission: false,
    })

    const derivedPubKey = await signer.getPublicKey()
    const expectedScript = buildP2PKHScript(derivedPubKey)

    const utxos: UTXO[] = []
    for (const out of result.outputs) {
      if (!out.spendable || !out.lockingScript) continue
      if (out.lockingScript !== expectedScript) continue

      const [txid, voutStr] = out.outpoint.split('.')
      utxos.push({
        txid: txid!,
        outputIndex: Number(voutStr),
        satoshis: out.satoshis,
        script: out.lockingScript,
      })
    }

    console.log('[WalletProvider] found', utxos.length, 'funding UTXOs, total:', utxos.reduce((s, u) => s + u.satoshis, 0), 'sats')
    return utxos
  }

  async getTransaction(txid: string): Promise<TransactionData> {
    // Try local cache first — covers recently broadcast txs
    const cached = txCache.get(txid)
    if (cached) {
      try {
        const tx = Transaction.fromHex(cached)
        const inputs: TxInput[] = tx.inputs.map(inp => ({
          txid: inp.sourceTXID || '',
          outputIndex: inp.sourceOutputIndex,
          script: inp.unlockingScript?.toHex() || '',
          sequence: inp.sequence ?? 0xffffffff,
        }))
        const outputs: TxOutput[] = tx.outputs.map(out => ({
          satoshis: out.satoshis ?? 0,
          script: out.lockingScript?.toHex() || '',
        }))
        return { txid, version: tx.version, inputs, outputs, locktime: tx.lockTime, raw: cached }
      } catch { /* fall through */ }
    }

    // Minimal fallback — the SDK only uses this for post-broadcast metadata
    return { txid, version: 1, inputs: [], outputs: [], locktime: 0 }
  }

  async broadcast(tx: any): Promise<string> {
    return broadcastTx(tx)
  }

  async getContractUtxo(_scriptHash: string): Promise<UTXO | null> {
    // Not used — contract UTXO comes from overlay via prepareSpend
    return null
  }

  getNetwork(): 'mainnet' | 'testnet' {
    return 'mainnet'
  }

  async getRawTransaction(txid: string): Promise<string> {
    return fetchRawTx(txid)
  }

  async getFeeRate(): Promise<number> {
    return 0.1
  }
}

// ---------------------------------------------------------------------------
// Funding
// ---------------------------------------------------------------------------

/**
 * Ensure we have enough P2PKH funding UTXOs in our game basket.
 * Creates one if needed via the BRC-100 wallet.
 */
export async function ensureFundingUtxos(minSatoshis: number): Promise<void> {
  const provider = new WalletProvider()
  const address = await signer.getAddress()
  const utxos = await provider.getUtxos(address)

  const totalAvailable = utxos.reduce((sum, u) => sum + u.satoshis, 0)
  if (totalAvailable >= minSatoshis) return

  const derivedPubKey = await signer.getPublicKey()
  const lockingScript = buildP2PKHScript(derivedPubKey)
  const fundAmount = minSatoshis - totalAvailable

  console.log('[ensureFunding] creating funding UTXO:', fundAmount, 'sats')
  const result = await wallet.createAction({
    description: 'Fund TicTacToe game actions',
    outputs: [{
      lockingScript,
      satoshis: fundAmount,
      outputDescription: 'TicTacToe funding UTXO',
      basket: GAME_BASKET,
      tags: [FUNDING_TAG],
    }],
  })

  // Cache the funding tx so child txs can build EF
  if (result.tx) {
    try {
      const tx = Transaction.fromAtomicBEEF(result.tx)
      const rawHex = tx.toHex()
      const txid = result.txid || ''
      if (txid) cacheTx(txid, rawHex)
      console.log('[ensureFunding] broadcasting funding tx to ARC:', txid)
      await broadcastToARC(rawHex)
    } catch (e: any) {
      console.warn('[ensureFunding] funding tx broadcast failed (may already be known):', e.message)
    }
  }
}
