/**
 * SDK configuration — wallet provider, artifact, and fee estimation.
 *
 * All transaction caching, EF format broadcasting, ARC integration, and
 * overlay submission is handled by the SDK's WalletProvider.
 */
import { WalletProvider, estimateCallFee } from 'runar-sdk'
import type { RunarArtifact } from 'runar-sdk'
import { wallet, signer } from './wallet'
import artifactJSON from '../generated/TicTacToe.runar.json'

export const OVERLAY_URL = import.meta.env.VITE_OVERLAY_URL || 'http://localhost:8081'

export const artifact = artifactJSON as unknown as RunarArtifact

export const provider = new WalletProvider({
  wallet,
  signer,
  basket: 'tic-tac-toe',
  fundingTag: 'funding',
  overlayUrl: OVERLAY_URL,
  overlayTopics: ['tm_tictactoe'],
  network: 'mainnet',
  feeRate: 0.1,
})

export function estimateFee(): number {
  return estimateCallFee(artifact.script.length / 2, artifact.script.length / 4, 1, 0.1)
}
