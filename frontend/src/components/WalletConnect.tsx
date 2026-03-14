import { useWallet } from '../hooks/useWallet'

export default function WalletConnect() {
  const { connected, pubkey, balance, refresh } = useWallet()

  if (!connected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: 'var(--color-error)', display: 'inline-block',
        }} />
        <span style={{ color: 'var(--color-text-dim)' }}>Wallet disconnected</span>
        <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={refresh}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: 'var(--color-success)', display: 'inline-block',
      }} />
      <span style={{ color: 'var(--color-text-dim)' }}>
        {pubkey.slice(0, 8)}...{pubkey.slice(-6)}
      </span>
      <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>
        {balance.toLocaleString()} sats
      </span>
    </div>
  )
}
