import { Link } from 'react-router-dom'
import WalletConnect from './WalletConnect'
import type { ReactNode } from 'react'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        padding: '14px 20px',
        background: 'rgba(10, 10, 20, 0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        flexWrap: 'wrap',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <Link to="/" style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 17,
            color: 'var(--color-text)',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            letterSpacing: '0.02em',
          }}>
            TIC-TAC-TOE
            <span style={{
              color: 'var(--color-accent)',
              fontSize: 10,
              fontWeight: 600,
              marginLeft: 6,
              letterSpacing: '0.08em',
              verticalAlign: 'super',
              textShadow: '0 0 8px rgba(255, 224, 64, 0.3)',
            }}>BSV</span>
          </Link>
          <nav style={{ display: 'flex', gap: 16, fontSize: 13 }}>
            <Link to="/">Games</Link>
            <Link to="/my-games">My Games</Link>
          </nav>
        </div>
        <WalletConnect />
      </header>
      <main style={{ flex: 1, padding: '24px 0' }}>
        <div className="container">
          {children}
        </div>
      </main>
    </div>
  )
}
