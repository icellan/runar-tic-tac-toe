import { GenericLookupService, type StateMapper } from 'runar-overlay-express'
import type { LookupFormula, LookupServiceMetaData } from '@bsv/overlay'
import type { LookupQuestion } from '@bsv/sdk'
import { artifact } from './artifact.js'
import { TicTacToeStorage, type OverlayGame } from './TicTacToeStorage.js'

const ZERO_PUBKEY = '00'.repeat(33)

const stateMapper: StateMapper<OverlayGame> = ({ txid, outputIndex, satoshis, lockingScript, state, constructorArgs }) => {
  const playerO = String(state.playerO || '')
  const now = new Date()
  return {
    txid,
    outputIndex,
    satoshis,
    lockingScript,
    playerX: String(constructorArgs.playerX || ''),
    playerO: playerO === ZERO_PUBKEY ? '' : playerO,
    board: (state.board as bigint[]).map(c => String(Number(c))).join(''),
    turn: Number(state.turn),
    status: Number(state.status),
    betAmount: Number(constructorArgs.betAmount ?? 0),
    createdAt: now,
    updatedAt: now,
  }
}

export class TicTacToeLookupService extends GenericLookupService<OverlayGame> {
  constructor(storage: TicTacToeStorage) {
    super(artifact, storage, stateMapper, {
      topic: 'tm_tictactoe',
      isTerminal: r => r.status >= 2,
    })
  }

  async lookup(question: LookupQuestion): Promise<LookupFormula> {
    const query = question.query as { type: string; pubkey?: string; txid?: string; page?: number; limit?: number }
    const storage = this.storage as TicTacToeStorage

    if (query.type === 'findOpenGames') {
      const { games } = await storage.findOpenGames(query.page || 1, query.limit || 20)
      return games.map(g => ({ txid: g.txid, outputIndex: g.outputIndex }))
    }
    if (query.type === 'findByPlayer' && query.pubkey) {
      const { games } = await storage.findByPlayer(query.pubkey, query.page || 1, query.limit || 20)
      return games.map(g => ({ txid: g.txid, outputIndex: g.outputIndex }))
    }
    if (query.type === 'findByTxid' && query.txid) {
      const game = await storage.findByTxid(query.txid)
      if (!game) return []
      return [{ txid: game.txid, outputIndex: game.outputIndex }]
    }
    return []
  }

  async getDocumentation(): Promise<string> {
    return 'TicTacToe lookup service. Queries: findOpenGames, findByPlayer, findByTxid.'
  }

  async getMetaData(): Promise<LookupServiceMetaData> {
    return {
      name: 'TicTacToe Lookup Service',
      shortDescription: 'Query TicTacToe on-chain games indexed from the BSV overlay',
      version: '0.1.0',
    }
  }
}
