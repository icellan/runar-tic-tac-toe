/**
 * Helper to load a typed TicTacToeContract instance for a game's current UTXO.
 * Uses overlay (via Go backend) for contract state — no WoC needed.
 */
import {
  RunarContract,
  extractStateFromScript,
  findLastOpReturn,
  estimateDeployFee,
} from 'runar-sdk'
import type { RunarArtifact } from 'runar-sdk'
import { TicTacToeContract } from '../generated/TicTacToeContract'
import artifactJSON from '../generated/TicTacToe.runar.json'
import { prepareSpend } from './api'
import { signer } from './wallet'
import { WalletProvider } from './wallet-provider'

export const artifact = artifactJSON as unknown as RunarArtifact
const provider = new WalletProvider()

/**
 * Load a TicTacToeContract connected to the game's current UTXO.
 * Uses prepareSpend (overlay via Go backend) for contract state.
 */
export async function loadGameContract(gameId: string): Promise<{
  contract: TicTacToeContract
  prep: Awaited<ReturnType<typeof prepareSpend>>
}> {
  const prep = await prepareSpend(gameId)

  const inner = new RunarContract(
    artifact,
    [prep.playerX, BigInt(prep.betAmount)],
  )

  const script = prep.lockingScript
  const lastOpReturn = findLastOpReturn(script)

  // Set the code portion of the on-chain script (everything before OP_RETURN)
  ;(inner as any)._codeScript = lastOpReturn !== -1
    ? script.slice(0, lastOpReturn)
    : script

  // Attach the current contract UTXO
  ;(inner as any).currentUtxo = {
    txid: prep.contractTxid,
    outputIndex: prep.contractVout,
    satoshis: prep.contractSatoshis,
    script,
  }

  // Extract and set state from the on-chain locking script
  const state = extractStateFromScript(artifact, script)
  if (state) inner.setState(state)

  inner.connect(provider, signer)

  // Wrap in typed class
  const typed = new TicTacToeContract(artifact, {
    playerX: prep.playerX,
    betAmount: BigInt(prep.betAmount),
  })
  ;(typed as any).inner = inner

  return { contract: typed, prep }
}

/**
 * Estimate the mining fee for a transaction spending this contract.
 */
export function estimateTxFee(): number {
  return estimateDeployFee(1, artifact.script.length / 2, 0.1)
}

export { provider }
