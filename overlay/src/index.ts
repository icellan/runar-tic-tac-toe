import 'dotenv/config'
import { MongoClient } from 'mongodb'
import {
  startOverlayServer,
  createTopicManager,
  mountSSERoute,
  mountBroadcastRoute,
  mountTxHexRoute,
} from 'runar-overlay-express'
import { mountDevSubmitRoute } from 'runar-overlay-express/regtest'
import { artifact } from './artifact.js'
import { TicTacToeStorage, type OverlayGame } from './TicTacToeStorage.js'
import { TicTacToeLookupService } from './TicTacToeLookupService.js'

const MODE: 'regtest' | 'production' = process.env.REGTEST === 'true' ? 'regtest' : 'production'
const PORT = parseInt(process.env.OVERLAY_PORT || '8081', 10)
const MONGODB_URI = process.env.MONGODB_URI
const MONGO_DB_NAME = 'tictactoe'
const HOSTING_URL = process.env.OVERLAY_HOSTING_URL || 'http://localhost:8081'
const PRIVATE_KEY = process.env.OVERLAY_PRIVATE_KEY || process.env.SERVER_PRIVATE_KEY
const TOPIC_NAME = 'tm_tictactoe'

if (!MONGODB_URI) throw new Error('MONGODB_URI is required')
if (MODE === 'production' && !PRIVATE_KEY) {
  throw new Error('OVERLAY_PRIVATE_KEY (or SERVER_PRIVATE_KEY) is required in production mode')
}

const knex = process.env.KNEX_URL
  ? { client: process.env.KNEX_URL.startsWith('mysql') ? 'mysql2' : 'pg', connection: process.env.KNEX_URL }
  : undefined

async function main() {
  const mongo = new MongoClient(MONGODB_URI!)
  await mongo.connect()
  const storage = new TicTacToeStorage(mongo.db(MONGO_DB_NAME))
  await storage.init()
  const lookupService = new TicTacToeLookupService(storage)

  await startOverlayServer({
    mode: MODE,
    port: PORT,
    mongoUri: MONGODB_URI!,
    mongoDbName: MONGO_DB_NAME,
    privateKey: PRIVATE_KEY,
    hostingUrl: HOSTING_URL,
    topicManagers: { [TOPIC_NAME]: createTopicManager(artifact, { topicName: TOPIC_NAME }) },
    lookupServices: { ls_tictactoe: lookupService },
    knex,
    patchSubmitEFToBEEF: true,
    registerRoutes: ({ app, engine }) => {
      // SSE + broadcast for game state (uses overlay-express helpers)
      const sseHub = mountSSERoute(app, {
        path: '/api/games/:roomId/events',
        initialState: async roomId => (await storage.findByTxid(roomId)) ?? undefined,
      })

      mountBroadcastRoute<OverlayGame>(app, {
        path: '/api/games/:roomId/broadcast',
        hub: sseHub,
        storage,
        getAllowedKeys: async roomId => {
          const game = await storage.findByTxid(roomId)
          if (!game) return null
          return [game.playerX, game.playerO].filter(Boolean)
        },
        parseState: payload => {
          const g: any = payload.game
          if (!g || typeof g !== 'object' || !g.txid) throw new Error('missing game state with txid')
          return {
            txid: g.txid,
            outputIndex: g.outputIndex ?? 0,
            playerX: g.playerX || '',
            playerO: g.playerO || '',
            board: g.board || '000000000',
            turn: g.turn ?? 0,
            status: g.status ?? 0,
            betAmount: g.betAmount ?? 0,
            satoshis: g.satoshis ?? 0,
            lockingScript: g.lockingScript || '',
            identityKeyX: g.identityKeyX,
            identityKeyO: g.identityKeyO,
            createdAt: new Date(g.createdAt || Date.now()),
            updatedAt: new Date(),
          }
        },
      })

      // Raw tx-hex passthrough (regtest RPC or production engine + WoC fallback)
      if (MODE === 'regtest') {
        mountTxHexRoute(app, {
          mode: 'regtest',
          rpcUrl: process.env.RPC_URL ?? 'http://localhost:18332',
          rpcUser: process.env.RPC_USER ?? 'bitcoin',
          rpcPass: process.env.RPC_PASS ?? 'bitcoin',
        })
      } else {
        mountTxHexRoute(app, { mode: 'production', engine: engine as any })
      }

      // Game query REST endpoints
      app.get('/api/games', async (_req, res) => {
        try {
          const { games } = await storage.findOpenGames(1, 50)
          res.json(games)
        } catch (err: any) { res.status(500).json({ error: err.message }) }
      })
      app.get('/api/games/by-player/:pubkey', async (req, res) => {
        try {
          const { games } = await storage.findByPlayer(req.params.pubkey, 1, 50)
          res.json(games)
        } catch (err: any) { res.status(500).json({ error: err.message }) }
      })
      app.get('/api/games/:txid', async (req, res) => {
        try {
          const game = await storage.findByTxid(req.params.txid)
          if (!game) return res.status(404).json({ error: 'not found' })
          res.json(game)
        } catch (err: any) { res.status(500).json({ error: err.message }) }
      })
      app.get('/stats', async (_req, res) => {
        try { res.json({ games: await storage.count() }) }
        catch { res.status(500).json({ games: 0 }) }
      })

      // App-specific: identity-key registration for the MessageBox cancel flow
      app.post('/api/identity', async (req, res) => {
        try {
          const { txid, derivedPubkey, identityKey } = req.body ?? {}
          if (!txid || !derivedPubkey || !identityKey) {
            return res.status(400).json({ error: 'missing txid, derivedPubkey, or identityKey' })
          }
          const game = await storage.findByTxid(txid)
          if (!game) return res.status(404).json({ error: 'game not found' })
          let field: 'identityKeyX' | 'identityKeyO'
          if (game.playerX === derivedPubkey) field = 'identityKeyX'
          else if (game.playerO === derivedPubkey) field = 'identityKeyO'
          else return res.status(403).json({ error: 'pubkey is not a player in this game' })
          await storage.updateIdentityKey(txid, field, identityKey)
          res.json({ ok: true })
        } catch (err: any) {
          res.status(500).json({ error: err.message })
        }
      })

      // Regtest-only: replay a raw tx through the lookup service for indexing.
      if (MODE === 'regtest') {
        mountDevSubmitRoute(app, { artifact, lookupService, topic: TOPIC_NAME })
      }
    },
  })

  console.log(`TicTacToe Overlay running on port ${PORT} [${MODE.toUpperCase()}]`)
}

main().catch(err => { console.error('Overlay failed to start:', err); process.exit(1) })
