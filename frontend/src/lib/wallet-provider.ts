import { WalletProvider, pubkeyToPKH, estimateFeeForArtifact } from 'runar-sdk'
import type { RunarArtifact } from 'runar-sdk'
import { wallet, signer } from './wallet'
import { TicTacToeContract } from '../generated/TicTacToeContract'
import type { Game } from './types'
import artifactJSON from '../../../contract/artifacts/TicTacToe.runar.json'

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
  return estimateFeeForArtifact(artifact, { feeRate: 0.1 })
}

/** Load the on-chain contract from local game state (no network call). */
export function loadContract(game: Game) {
  const contract = TicTacToeContract.fromUtxo(artifact, {
    txid: game.txid,
    outputIndex: game.outputIndex,
    satoshis: game.satoshis,
    script: game.lockingScript,
  })
  contract.connect(provider, signer)
  return contract
}

export { pubkeyToPKH }
