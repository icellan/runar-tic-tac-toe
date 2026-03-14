import { Collection, Db } from 'mongodb'

export interface OverlayGame {
  txid: string
  outputIndex: number
  playerX: string
  playerO: string
  board: string        // '000000000' — 9 chars, 0=empty, 1=X, 2=O
  turn: number         // 1=X, 2=O
  status: number       // 0=waiting, 1=playing, 2=x_wins, 3=o_wins, 4=tie, 5=cancelled
  betAmount: number
  satoshis: number
  lockingScript: string
  identityKeyX?: string
  identityKeyO?: string
  createdAt: Date
  updatedAt: Date
}

export class TicTacToeStorage {
  private collection: Collection<OverlayGame>

  constructor(db: Db) {
    this.collection = db.collection<OverlayGame>('overlay_tictactoe')
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ txid: 1, outputIndex: 1 }, { unique: true }),
      this.collection.createIndex({ status: 1 }),
      this.collection.createIndex({ playerX: 1 }),
      this.collection.createIndex({ playerO: 1 }),
      this.collection.createIndex({ updatedAt: -1 }),
    ])
  }

  async upsertGame(doc: OverlayGame): Promise<void> {
    await this.collection.updateOne(
      { txid: doc.txid, outputIndex: doc.outputIndex },
      { $set: doc },
      { upsert: true }
    )
  }

  async findOpenGames(page: number = 1, limit: number = 20): Promise<{ games: OverlayGame[]; total: number }> {
    const filter = { status: 0 }
    const skip = (page - 1) * limit
    const [games, total] = await Promise.all([
      this.collection.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      this.collection.countDocuments(filter),
    ])
    return { games, total }
  }

  async findByPlayer(pubkey: string, page: number = 1, limit: number = 20): Promise<{ games: OverlayGame[]; total: number }> {
    const filter = { $or: [{ playerX: pubkey }, { playerO: pubkey }] }
    const skip = (page - 1) * limit
    const [games, total] = await Promise.all([
      this.collection.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).toArray(),
      this.collection.countDocuments(filter),
    ])
    return { games, total }
  }

  async findByTxid(txid: string): Promise<OverlayGame | null> {
    return this.collection.findOne({ txid })
  }

  async findAll(page: number = 1, limit: number = 20): Promise<{ games: OverlayGame[]; total: number }> {
    const skip = (page - 1) * limit
    const [games, total] = await Promise.all([
      this.collection.find().sort({ updatedAt: -1 }).skip(skip).limit(limit).toArray(),
      this.collection.countDocuments(),
    ])
    return { games, total }
  }

  async count(): Promise<number> {
    return this.collection.countDocuments()
  }

  async setIdentityKey(txid: string, field: 'identityKeyX' | 'identityKeyO', identityKey: string): Promise<boolean> {
    const result = await this.collection.updateOne(
      { txid },
      { $set: { [field]: identityKey } },
    )
    return result.matchedCount > 0
  }

  async deleteByTxid(txid: string, outputIndex: number): Promise<void> {
    await this.collection.deleteOne({ txid, outputIndex })
  }
}
