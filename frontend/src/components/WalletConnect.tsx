import { useWallet } from 'runar-react'

export default function WalletConnect() {
  const { connected, identityKey, refresh } = useWallet()

  if (!connected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: 'var(--color-error)', display: 'inline-block',
          boxShadow: '0 0 6px rgba(255, 82, 82, 0.5)',
        }} />
        <span style={{ color: 'var(--color-text-dim)' }}>No wallet</span>
        <button className="btn-secondary" style={{ padding: '5px 12px', fontSize: 12 }} onClick={refresh}>
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
        boxShadow: '0 0 6px rgba(0, 229, 255, 0.5)',
      }} />
      <span style={{ color: 'var(--color-text-dim)' }}>
        {identityKey.slice(0, 8)}...{identityKey.slice(-6)}
      </span>
    </div>
  )
}
