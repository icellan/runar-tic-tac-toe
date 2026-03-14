import { TopicManager, AdmittanceInstructions } from '@bsv/overlay'
import { Transaction } from '@bsv/sdk'
import { findLastOpReturn } from 'runar-sdk'

/**
 * The OP_PUSH_TX generator pubkey (k=1) that all Runar contracts use.
 * This is a reliable fingerprint for identifying Runar contract outputs.
 */
const RUNAR_PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

/**
 * TicTacToe state has exactly 12 fields after OP_RETURN:
 *   playerO (33 bytes) + c0..c8 (8 bytes each) + turn (8 bytes) + status (8 bytes)
 * Total state size: 33 + 9*8 + 8 + 8 = 121 bytes = 242 hex chars
 */
const EXPECTED_STATE_HEX_LEN = 242

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

          // Must contain the Runar OP_PUSH_TX pubkey
          if (!scriptHex.includes(RUNAR_PUBKEY)) continue

          // Use SDK's proper opcode-walking OP_RETURN finder
          const opReturnPos = findLastOpReturn(scriptHex)
          if (opReturnPos === -1) continue

          // Verify state section length matches TicTacToe
          const stateHex = scriptHex.slice(opReturnPos + 2)
          if (stateHex.length !== EXPECTED_STATE_HEX_LEN) continue

          outputsToAdmit.push(i)
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

## State Layout (121 bytes after OP_RETURN)
- playerO: 33 bytes (compressed pubkey, all zeros if not joined)
- c0..c8: 8 bytes each (0=empty, 1=X, 2=O)
- turn: 8 bytes (1=X turn, 2=O turn)
- status: 8 bytes (0=waiting, 1=playing)

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
