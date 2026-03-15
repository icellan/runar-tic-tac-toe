import { WalletClient, SecurityLevel } from '@bsv/sdk'
import { WalletSigner } from 'runar-sdk'

export const PROTOCOL_ID: [SecurityLevel, string] = [2 as SecurityLevel, 'tic tac toe']
export const KEY_ID = '1'

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
