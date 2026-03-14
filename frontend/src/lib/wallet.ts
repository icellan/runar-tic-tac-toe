import { WalletClient, SecurityLevel } from '@bsv/sdk'
import { WalletSigner } from 'runar-sdk'

export const PROTOCOL_ID: [SecurityLevel, string] = [2 as SecurityLevel, 'tic tac toe']
export const KEY_ID = '1'
const GAME_BASKET = 'tic-tac-toe'

// Shared wallet client and signer (SDK handles caching, protocol ID, key derivation)
export const wallet = new WalletClient()
export const signer = new WalletSigner({ protocolID: PROTOCOL_ID, keyID: KEY_ID, wallet })

// ---------------------------------------------------------------------------
// Wallet connection
// ---------------------------------------------------------------------------

export async function checkWalletConnection(): Promise<boolean> {
  try {
    await wallet.getVersion()
    return true
  } catch {
    return false
  }
}

export async function getWalletIdentityKey(): Promise<string | null> {
  try {
    const { publicKey } = await wallet.getPublicKey({ identityKey: true })
    return publicKey || null
  } catch {
    return null
  }
}

/** Get the derived public key for TicTacToe (delegates to WalletSigner) */
export async function getDerivedPubKey(): Promise<string> {
  return signer.getPublicKey()
}

/** Sign a pre-computed sighash with the TicTacToe derived key */
export async function signContractHash(sighash: number[]): Promise<number[]> {
  const result = await wallet.createSignature({
    hashToDirectlySign: sighash,
    protocolID: PROTOCOL_ID,
    keyID: KEY_ID,
    counterparty: 'self',
  })
  return result.signature
}

// ---------------------------------------------------------------------------
// Wallet transaction actions (BRC-100 two-phase flow)
// ---------------------------------------------------------------------------

export async function walletCreateAction(params: {
  description: string
  outputs: Array<{ lockingScript: string; satoshis: number; outputDescription: string }>
}): Promise<{ txid: string; vout: number; satoshis: number }> {
  const result = await wallet.createAction({
    description: params.description,
    outputs: params.outputs.map(o => ({ ...o, basket: GAME_BASKET })),
  })

  // Parse the BEEF to find the correct vout for our locking script
  // and cache the raw tx hex for EF broadcast of child txs later
  const lockingScript = params.outputs[0]?.lockingScript || ''
  let vout = 0
  let satoshis = params.outputs[0]?.satoshis || 0
  if (result.tx && lockingScript) {
    try {
      const { Transaction } = await import('@bsv/sdk')
      const { cacheTx } = await import('./wallet-provider')
      const tx = Transaction.fromAtomicBEEF(result.tx)
      for (let i = 0; i < tx.outputs.length; i++) {
        const out = tx.outputs[i]
        if (out.lockingScript?.toHex() === lockingScript) {
          vout = i
          satoshis = out.satoshis ?? satoshis
          break
        }
      }
      // Cache raw hex so child txs can build EF without waiting for WoC
      const txid = result.txid || ''
      if (txid) {
        cacheTx(txid, tx.toHex())
        console.log('[wallet] cached deploy tx', txid, 'for EF')
      }
    } catch (e) {
      console.warn('[wallet] Could not parse BEEF to find vout:', e)
    }
  }

  return { txid: result.txid || '', vout, satoshis }
}

