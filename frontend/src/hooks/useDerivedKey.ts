import { useState, useEffect } from 'react'
import { useWallet } from './useWallet'
import { getDerivedPubKey, getWalletIdentityKey } from '../lib/wallet'

/** Derives the TicTacToe public key and identity key when wallet is connected. */
export function useDerivedKey() {
  const { connected } = useWallet()
  const [derivedKey, setDerivedKey] = useState('')
  const [identityKey, setIdentityKey] = useState('')

  useEffect(() => {
    if (!connected) return
    getDerivedPubKey().then(setDerivedKey).catch(console.error)
    getWalletIdentityKey().then((k) => { if (k) setIdentityKey(k) }).catch(console.error)
  }, [connected])

  return { derivedKey, identityKey }
}
