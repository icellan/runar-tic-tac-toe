import { Link } from 'react-router-dom'
import WalletConnect from './WalletConnect'
import type { ReactNode } from 'react'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        padding: '12px 16px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Link to="/" style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-text)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Tic-Tac-Toe <span style={{ color: 'var(--color-accent)', fontSize: 11 }}>on BSV</span>
          </Link>
          <nav style={{ display: 'flex', gap: 12, fontSize: 13 }}>
            <Link to="/">Games</Link>
            <Link to="/my-games">My Games</Link>
          </nav>
        </div>
        <WalletConnect />
      </header>
      <main style={{ flex: 1, padding: '20px 0' }}>
        <div className="container">
          {children}
        </div>
      </main>
    </div>
  )
}
