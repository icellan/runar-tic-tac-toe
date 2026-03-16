import 'dotenv/config'
import { mkdirSync } from 'fs'
import OverlayExpress from '@bsv/overlay-express'
import { WhatsOnChain, FetchHttpClient } from '@bsv/sdk'
import { MongoClient } from 'mongodb'
import { TicTacToeTopicManager } from './TicTacToeTopicManager.js'
import { TicTacToeLookupService } from './TicTacToeLookupService.js'
import { TicTacToeStorage } from './TicTacToeStorage.js'
import { SSEHub } from './SSEHub.js'

const PRIVATE_KEY = process.env.OVERLAY_PRIVATE_KEY || process.env.SERVER_PRIVATE_KEY
const HOSTING_URL = process.env.OVERLAY_HOSTING_URL || 'http://localhost:8081'
const PORT = parseInt(process.env.OVERLAY_PORT || '8081', 10)
const MONGODB_URI = process.env.MONGODB_URI

if (!PRIVATE_KEY) {
  throw new Error('OVERLAY_PRIVATE_KEY (or SERVER_PRIVATE_KEY) is required')
}
if (!MONGODB_URI) {
  throw new Error('MONGODB_URI is required')
}

async function main() {
  // MongoDB for custom game storage
  const mongoClient = new MongoClient(MONGODB_URI!)
  await mongoClient.connect()
  const db = mongoClient.db('tictactoe')
  const storage = new TicTacToeStorage(db)
  await storage.ensureIndexes()
  console.log('Connected to MongoDB — overlay_tictactoe collection ready')

  // SQLite for overlay engine state (GASP sync, UTXO tracking)
  mkdirSync('./data', { recursive: true })
  const knexConfig = process.env.KNEX_URL
    ? {
        client: (process.env.KNEX_URL as string).startsWith('mysql') ? 'mysql2' : 'pg',
        connection: process.env.KNEX_URL,
      }
    : {
        client: 'better-sqlite3',
        connection: { filename: './data/overlay.db' },
        useNullAsDefault: true,
      }

  const server = new OverlayExpress(
    'tictactoe-overlay',
    PRIVATE_KEY!,
    HOSTING_URL
  )

  server.configurePort(PORT)
  server.configureKnex(knexConfig)
  await server.configureMongo(MONGODB_URI!)

  // Register our custom topic manager and lookup service
  server.configureTopicManager('tm_tictactoe', new TicTacToeTopicManager())
  server.configureLookupService('ls_tictactoe', new TicTacToeLookupService(storage))

  // Disable GASP sync for local dev (enable in production with peer nodes)
  server.configureEnableGASPSync(false)

  // Chain tracker for verifying merkle proofs
  server.configureChainTracker(
    new WhatsOnChain('main', { httpClient: new FetchHttpClient(fetch) })
  )

  // Build the engine
  await server.configureEngine()

  const engine = (server as any).engine

  // Disable default advertiser/broadcaster to avoid OOM on local dev
  engine.advertiser = undefined
  engine.broadcaster = undefined

  // Register custom routes BEFORE server.start() — overlay-express adds a
  // 404 catch-all during start(), so routes registered after would be unreachable.
  const app = (server as any).app
  if (app) {
    // Game query REST API
    app.get('/api/games', async (req: any, res: any) => {
      try {
        const { games } = await storage.findOpenGames(1, 50)
        res.json(games)
      } catch (err: any) {
        res.status(500).json({ error: err.message })
      }
    })

    app.get('/api/games/by-player/:pubkey', async (req: any, res: any) => {
      try {
        const { games } = await storage.findByPlayer(req.params.pubkey, 1, 50)
        res.json(games)
      } catch (err: any) {
        res.status(500).json({ error: err.message })
      }
    })

    app.get('/api/games/:txid', async (req: any, res: any) => {
      try {
        const game = await storage.findByTxid(req.params.txid)
        if (!game) return res.status(404).json({ error: 'not found' })
        res.json(game)
      } catch (err: any) {
        res.status(500).json({ error: err.message })
      }
    })

    // Raw transaction hex lookup — used by frontend provider for EF parent txs
    app.get('/api/tx/:txid/hex', async (req: any, res: any) => {
      try {
        // Try the overlay engine's storage first
        if (engine?.managers) {
          for (const mgr of Object.values(engine.managers) as any[]) {
            if (mgr?.storage?.findOutput) {
              // Engine stores outputs keyed by txid
              try {
                const beef = await engine.getUTXOHistory?.({ txid: req.params.txid, outputIndex: 0 })
                if (beef) {
                  const { Transaction } = await import('@bsv/sdk')
                  const tx = Transaction.fromBEEF(beef)
                  res.type('text/plain').send(tx.toHex())
                  return
                }
              } catch { /* fall through */ }
            }
          }
        }
        res.status(404).send('not found')
      } catch (err: any) {
        res.status(500).send(err.message)
      }
    })

    app.get('/stats', async (_req: any, res: any) => {
      try {
        const games = await storage.count()
        res.json({ games })
      } catch {
        res.status(500).json({ games: 0 })
      }
    })

    // SSE hub for real-time game updates
    const sseHub = new SSEHub()

    // SSE endpoint — subscribe to live game updates
    app.get('/api/games/:roomId/events', async (req: any, res: any) => {
      const { roomId } = req.params
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })

      // Send initial state: cached last broadcast or fetch from DB
      const cached = sseHub.getLastState(roomId)
      if (cached) {
        res.write(`data: ${JSON.stringify(cached)}\n\n`)
      } else {
        try {
          const game = await storage.findByTxid(roomId)
          if (game) {
            res.write(`data: ${JSON.stringify(game)}\n\n`)
          }
        } catch { /* ignore */ }
      }

      sseHub.subscribe(roomId, res)
      req.on('close', () => sseHub.unsubscribe(roomId, res))
    })

    // Broadcast endpoint — relay game state to SSE subscribers
    app.post('/api/games/:roomId/broadcast', async (req: any, res: any) => {
      const { roomId } = req.params
      const game = req.body
      if (!game || !game.txid) {
        return res.status(400).json({ error: 'missing game state with txid' })
      }
      sseHub.broadcast(roomId, game)
      res.json({ txid: game.txid, roomId, game })
    })

    // Register a player's identity key for MessageBox cancel flow
    app.post('/api/identity', async (req: any, res: any) => {
      try {
        const { txid, derivedPubkey, identityKey } = req.body
        if (!txid || !derivedPubkey || !identityKey) {
          return res.status(400).json({ error: 'missing txid, derivedPubkey, or identityKey' })
        }
        const game = await storage.findByTxid(txid)
        if (!game) {
          return res.status(404).json({ error: 'game not found' })
        }
        let field: 'identityKeyX' | 'identityKeyO'
        if (game.playerX === derivedPubkey) {
          field = 'identityKeyX'
        } else if (game.playerO === derivedPubkey) {
          field = 'identityKeyO'
        } else {
          return res.status(403).json({ error: 'pubkey is not a player in this game' })
        }
        await storage.setIdentityKey(txid, field, identityKey)
        console.log(`[identity] Set ${field} for game ${txid}`)
        res.json({ ok: true })
      } catch (err: any) {
        console.error('[identity] error:', err)
        res.status(500).json({ error: err.message })
      }
    })
  }

  await server.start()
  console.log(`TicTacToe Overlay running on port ${PORT}`)
  console.log(`  Submit txs:  POST ${HOSTING_URL}/submit`)
  console.log(`  Lookup:      POST ${HOSTING_URL}/lookup`)
}

main().catch(err => {
  console.error('Overlay failed to start:', err)
  process.exit(1)
})
