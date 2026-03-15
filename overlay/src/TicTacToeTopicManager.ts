import { TopicManager, AdmittanceInstructions } from '@bsv/overlay'
import { Transaction } from '@bsv/sdk'
import { matchesArtifact } from 'runar-sdk'
import { artifact } from './artifact.js'

export class TicTacToeTopicManager implements TopicManager {
  async identifyAdmissibleOutputs(
    beef: number[],
    previousCoins: number[]
  ): Promise<AdmittanceInstructions> {
    const outputsToAdmit: number[] = []

    try {
      const tx = Transaction.fromBEEF(beef)

      for (let i = 0; i < tx.outputs.length; i++) {
        try {
          const output = tx.outputs[i]
          if (!output.lockingScript) continue

          const scriptHex = output.lockingScript.toHex()
          if (matchesArtifact(artifact, scriptHex)) {
            outputsToAdmit.push(i)
          }
        } catch {
          continue
        }
      }
    } catch (err) {
      console.error('TicTacToeTopicManager: Failed to parse BEEF:', err)
    }

    return {
      outputsToAdmit,
      coinsToRetain: [],
    }
  }

  async getDocumentation(): Promise<string> {
    return `# TicTacToe Topic Manager

Manages admittance of TicTacToe Runar smart contract UTXOs on BSV.

## Protocol
Each TicTacToe output is a Runar stateful contract with:
- Constructor args baked into script: playerX (PubKey), betAmount (bigint)
- OP_RETURN state: playerO, c0-c8 (board), turn, status

## Contract Lifecycle
1. Deploy: creates UTXO with initial state (status=0, empty board)
2. Join: opponent joins, sets playerO, status=1
3. Move: updates board cell, flips turn
4. Terminal: moveAndWin, moveAndTie, cancel, cancelBeforeJoin — spends UTXO

When a terminal method is called, the UTXO is spent with no continuation output.`
  }

  async getMetaData(): Promise<{
    name: string
    shortDescription: string
    iconURL?: string
    version?: string
    informationURL?: string
  }> {
    return {
      name: 'TicTacToe Topic Manager',
      shortDescription: 'Indexes TicTacToe on-chain game contract UTXOs',
      version: '0.1.0',
    }
  }
}
