import type {
  LookupService, LookupFormula, OutputAdmittedByTopic, OutputSpent,
  LookupServiceMetaData, AdmissionMode, SpendNotificationMode
} from '@bsv/overlay'
import type { LookupQuestion } from '@bsv/sdk'
import { deserializeState, findLastOpReturn, extractConstructorArgs } from 'runar-sdk'
import { TicTacToeStorage } from './TicTacToeStorage.js'
import { artifact } from './artifact.js'

const STATE_FIELDS = artifact.stateFields!
const ZERO_PUBKEY = '00'.repeat(33)

export class TicTacToeLookupService implements LookupService {
  private storage: TicTacToeStorage

  readonly admissionMode: AdmissionMode = 'locking-script'
  readonly spendNotificationMode: SpendNotificationMode = 'none'

  constructor(storage: TicTacToeStorage) {
    this.storage = storage
  }

  async outputAdmittedByTopic(payload: OutputAdmittedByTopic): Promise<void> {
    if (payload.topic !== 'tm_tictactoe') return
    if (payload.mode !== 'locking-script') return

    const { txid, outputIndex, satoshis, lockingScript } = payload
    const scriptHex = lockingScript.toHex()

    const opReturnPos = findLastOpReturn(scriptHex)
    if (opReturnPos === -1) {
      console.warn(`[TicTacToeLookup] No OP_RETURN found in ${txid}:${outputIndex}`)
      return
    }
    const stateHex = scriptHex.slice(opReturnPos + 2)
    const state = deserializeState(STATE_FIELDS, stateHex)

    // Extract constructor args using artifact metadata
    const ctorArgs = extractConstructorArgs(artifact, scriptHex)
    const playerX = String(ctorArgs.playerX || '')
    const betAmount = Number(ctorArgs.betAmount ?? 0)

    // Map SDK state to storage format
    const playerO = String(state.playerO || '')
    const board = [
      state.c0, state.c1, state.c2,
      state.c3, state.c4, state.c5,
      state.c6, state.c7, state.c8,
    ].map(c => String(Number(c))).join('')
    const turn = Number(state.turn)
    const status = Number(state.status)

    await this.storage.upsertGame({
      txid,
      outputIndex,
      playerX,
      playerO: playerO === ZERO_PUBKEY ? '' : playerO,
      board,
      turn,
      status,
      betAmount,
      satoshis,
      lockingScript: scriptHex,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    console.log(`[TicTacToeLookup] Indexed game ${txid}:${outputIndex} status=${status} board=${board}`)
  }

  async outputSpent(payload: OutputSpent): Promise<void> {
    await this.storage.deleteByTxid(payload.txid, payload.outputIndex)
  }

  async outputEvicted(txid: string, outputIndex: number): Promise<void> {
    await this.storage.deleteByTxid(txid, outputIndex)
  }

  async outputNoLongerRetainedInHistory(txid: string, outputIndex: number, topic: string): Promise<void> {
    await this.storage.deleteByTxid(txid, outputIndex)
  }

  async lookup(question: LookupQuestion): Promise<LookupFormula> {
    const query = question.query as {
      type: string
      pubkey?: string
      txid?: string
      page?: number
      limit?: number
    }

    if (query.type === 'findOpenGames') {
      const { games } = await this.storage.findOpenGames(query.page || 1, query.limit || 20)
      return games.map(g => ({ txid: g.txid, outputIndex: g.outputIndex }))
    }

    if (query.type === 'findByPlayer' && query.pubkey) {
      const { games } = await this.storage.findByPlayer(query.pubkey, query.page || 1, query.limit || 20)
      return games.map(g => ({ txid: g.txid, outputIndex: g.outputIndex }))
    }

    if (query.type === 'findByTxid' && query.txid) {
      const game = await this.storage.findByTxid(query.txid)
      if (!game) return []
      return [{ txid: game.txid, outputIndex: game.outputIndex }]
    }

    if (query.type === 'findAll') {
      const { games } = await this.storage.findAll(query.page || 1, query.limit || 20)
      return games.map(g => ({ txid: g.txid, outputIndex: g.outputIndex }))
    }

    return []
  }

  async getDocumentation(): Promise<string> {
    return `# TicTacToe Lookup Service

Query TicTacToe games indexed from the BSV Overlay Network.

## Query Types

### findOpenGames
Find games waiting for an opponent (status=0).
\`\`\`json
{ "type": "findOpenGames", "page": 1, "limit": 20 }
\`\`\`

### findByPlayer
Find games where a pubkey is playerX or playerO.
\`\`\`json
{ "type": "findByPlayer", "pubkey": "<compressed-pubkey-hex>" }
\`\`\`

### findByTxid
Find a specific game by its current UTXO txid.
\`\`\`json
{ "type": "findByTxid", "txid": "<txid>" }
\`\`\`

### findAll
Paginated listing of all indexed games.
\`\`\`json
{ "type": "findAll", "page": 1, "limit": 20 }
\`\`\``
  }

  async getMetaData(): Promise<LookupServiceMetaData> {
    return {
      name: 'TicTacToe Lookup Service',
      shortDescription: 'Query TicTacToe on-chain games indexed from the BSV overlay',
      version: '0.1.0',
    }
  }
}
