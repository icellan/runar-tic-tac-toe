import { useState } from 'react'
import { useWallet } from '../hooks/useWallet'
import { useDerivedKey } from '../hooks/useDerivedKey'
import { useNavigate } from 'react-router-dom'
import { recordAction, registerIdentityKey } from '../lib/api'
import { signer } from '../lib/wallet'
import { TicTacToeContract } from '../generated/TicTacToeContract'
import { artifact, provider, estimateFee } from '../lib/wallet-provider'

interface CreateGameModalProps {
  open: boolean
  onClose: () => void
}

export default function CreateGameModal({ open, onClose }: CreateGameModalProps) {
  const { connected } = useWallet()
  const { derivedKey, identityKey } = useDerivedKey()
  const navigate = useNavigate()
  const [betAmount, setBetAmount] = useState(1000)
  const [isPublic, setIsPublic] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  function handleClose() {
    setError('')
    onClose()
  }

  async function handleCreate() {
    if (!connected || !derivedKey) {
      setError('Connect your wallet first')
      return
    }

    setLoading(true)
    setError('')

    try {
      const contract = new TicTacToeContract(artifact, {
        playerX: derivedKey,
        betAmount: BigInt(betAmount),
      })
      contract.connect(provider, signer)

      // Overfund by the estimated terminal tx fee so cancel/win payouts
      // have enough for mining.
      const txFeeMargin = estimateFee()
      const { txid, outputIndex } = await contract.deployWithWallet({
        satoshis: betAmount + txFeeMargin,
        description: `Create Tic-Tac-Toe game (${betAmount} sats bet)`,
      })

      const broadcastResult = await recordAction(txid, txid, 'create', {
        playerPubKey: derivedKey,
        betAmount,
        contractSatoshis: betAmount + txFeeMargin,
        isPublic,
        lockingScript: contract.getLockingScript(),
        vout: outputIndex,
      })

      if (identityKey) {
        registerIdentityKey(txid, derivedKey, identityKey).catch(console.error)
      }

      onClose()
      navigate(`/game/${broadcastResult.gameId || broadcastResult.txid}`)
    } catch (err: any) {
      console.error('[create-game]', err)
      setError('Failed to create game')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)',
    }} onClick={handleClose}>
      <div className="card" style={{
        width: 400, maxWidth: '90vw',
        animation: 'fadeIn 0.2s ease-out',
      }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: 20, fontSize: 18 }}>New Game</h2>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--color-text-dim)' }}>
            Bet Amount (satoshis)
          </label>
          <input
            type="number"
            min={1}
            value={betAmount}
            onChange={e => setBetAmount(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={e => setIsPublic(e.target.checked)}
            />
            Public game (visible in lobby)
          </label>
        </div>

        {error && (
          <div style={{ marginBottom: 16, padding: 10, borderRadius: 6, background: 'rgba(255, 107, 107, 0.1)', color: 'var(--color-error)', fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={handleClose} disabled={loading}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleCreate} disabled={loading || !connected}>
            {loading ? 'Creating...' : 'Create Game'}
          </button>
        </div>
      </div>
    </div>
  )
}
