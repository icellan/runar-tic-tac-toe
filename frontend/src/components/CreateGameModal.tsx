import { useState } from 'react'
import { useWallet } from '../hooks/useWallet'
import { useNavigate } from 'react-router-dom'
import { recordAction, registerIdentityKey } from '../lib/api'
import { walletCreateAction, getDerivedPubKey, getWalletIdentityKey } from '../lib/wallet'
import { TicTacToeContract } from '../generated/TicTacToeContract'
import { artifact, estimateTxFee } from '../lib/game-contract'

interface CreateGameModalProps {
  open: boolean
  onClose: () => void
}

export default function CreateGameModal({ open, onClose }: CreateGameModalProps) {
  const { connected, pubkey } = useWallet()
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
    if (!connected) {
      setError('Connect your wallet first')
      return
    }

    setLoading(true)
    setError('')

    try {
      // 1. Get derived pubkey for contract interactions
      const derivedPK = await getDerivedPubKey()

      // 2. Generate locking script locally using the typed contract
      const contract = new TicTacToeContract(artifact, {
        playerX: derivedPK,
        betAmount: BigInt(betAmount),
      })
      const lockingScript = contract.contract.getLockingScript()

      // 3. Ask wallet to create and fund the transaction
      // Overfund by the estimated terminal tx fee so cancel/win payouts have enough for mining.
      const txFeeMargin = estimateTxFee()
      const walletResult = await walletCreateAction({
        outputs: [{ lockingScript, satoshis: betAmount + txFeeMargin, outputDescription: 'TicTacToe contract UTXO' }],
        description: `Create Tic-Tac-Toe game (${betAmount} sats bet)`,
      })

      // 4. Record in backend (wallet already broadcast via ARC)
      const broadcastResult = await recordAction(
        walletResult.txid || 'pending',
        walletResult.txid || 'pending',
        'create',
        {
          playerPubKey: derivedPK,
          betAmount,
          contractSatoshis: walletResult.satoshis,
          isPublic,
          lockingScript,
          vout: walletResult.vout,
        }
      )

      // Register identity key with overlay for MessageBox cancel flow
      const idKey = await getWalletIdentityKey()
      if (idKey) {
        registerIdentityKey(walletResult.txid, derivedPK, idKey).catch(console.error)
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
