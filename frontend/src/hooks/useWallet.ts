import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
import type { WalletState } from '../lib/types'
import { checkWalletConnection, getWalletIdentityKey } from '../lib/wallet'

interface WalletContextValue extends WalletState {
  refresh: () => Promise<void>
}

export const WalletContext = createContext<WalletContextValue>({
  connected: false,
  pubkey: '',
  balance: 0,
  refresh: async () => {},
})

export function useWalletProvider(): WalletContextValue {
  const [state, setState] = useState<WalletState>({
    connected: false,
    pubkey: '',
    balance: 0,
  })
  const identityKey = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    const connected = await checkWalletConnection()
    if (!connected) {
      setState({ connected: false, pubkey: '', balance: 0 })
      return
    }

    // Only fetch identity key once — it never changes
    if (!identityKey.current) {
      identityKey.current = await getWalletIdentityKey() || ''
    }

    setState({
      connected: true,
      pubkey: identityKey.current,
      balance: 0,
    })
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 10000)
    return () => clearInterval(interval)
  }, [refresh])

  return { ...state, refresh }
}

export function useWallet(): WalletContextValue {
  return useContext(WalletContext)
}
