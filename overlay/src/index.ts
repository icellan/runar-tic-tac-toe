import 'dotenv/config'
import { mkdirSync } from 'fs'
import express from 'express'
import OverlayExpress from '@bsv/overlay-express'
import { WhatsOnChain, FetchHttpClient, Transaction } from '@bsv/sdk'
import { MongoClient } from 'mongodb'
import { TicTacToeTopicManager } from './TicTacToeTopicManager.js'
import { TicTacToeLookupService } from './TicTacToeLookupService.js'
import { TicTacToeStorage } from './TicTacToeStorage.js'
import { SSEHub } from './SSEHub.js'
import { matchesArtifact } from 'runar-sdk'
import { artifact } from './artifact.js'

const IS_REGTEST = process.env.REGTEST === 'true'
const RPC_URL = process.env.RPC_URL ?? 'http://localhost:18332'
const RPC_USER = process.env.RPC_USER ?? 'bitcoin'
const RPC_PASS = process.env.RPC_PASS ?? 'bitcoin'

/** JSON-RPC call to the regtest node. Only used when REGTEST=true. */
async function rpcCall(method: string, ...params: unknown[]): Promise<unknown> {
  const auth = Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64')
  const resp = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'overlay', method, params }),
    signal: AbortSignal.timeout(600_000),
  })
  const json = (await resp.json()) as { result: unknown; error: any }
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message ?? JSON.stringify(json.error)}`)
  return json.result
}

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

// ---------------------------------------------------------------------------
// Regtest mode: plain Express server with just MongoDB — no overlay engine,
// no knex, no SQLite/MySQL/PostgreSQL. Only requires: regtest node + MongoDB.
// ---------------------------------------------------------------------------
async function mainRegtest() {
  const mongoClient = new MongoClient(MONGODB_URI!)
  await mongoClient.connect()
  const db = mongoClient.db('tictactoe')
  const storage = new TicTacToeStorage(db)
  await storage.ensureIndexes()
  console.log('[regtest] Connected to MongoDB')

  const app = express()
  app.use(express.json())

  // CORS
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })

  // --- Game query REST API (same as production) ---

  app.get('/api/games', async (req, res) => {
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

  // Raw tx hex — fetch from regtest node
  app.get('/api/tx/:txid/hex', async (req, res) => {
    try {
      const hex = await rpcCall('getrawtransaction', req.params.txid, false) as string
      res.type('text/plain').send(hex)
    } catch (err: any) { res.status(404).send('not found') }
  })

  app.get('/stats', async (_req, res) => {
    try {
      const games = await storage.count()
      res.json({ games })
    } catch { res.status(500).json({ games: 0 }) }
  })

  // --- Dev submit: processes raw tx hex through LookupService ---

  const lookupService = new TicTacToeLookupService(storage)
  app.post('/dev/submit', async (req, res) => {
    try {
      const { txHex } = req.body
      if (!txHex) return res.status(400).json({ error: 'missing txHex' })
      const tx = Transaction.fromHex(txHex)
      const txid = tx.id('hex')
      let admitted = 0
      for (let i = 0; i < tx.outputs.length; i++) {
        const output = tx.outputs[i]
        if (!output.lockingScript) continue
        const scriptHex = output.lockingScript.toHex()
        if (matchesArtifact(artifact, scriptHex)) {
          await lookupService.outputAdmittedByTopic({
            txid,
            outputIndex: i,
            topic: 'tm_tictactoe',
            satoshis: output.satoshis ?? 0,
            lockingScript: output.lockingScript,
            mode: 'locking-script' as any,
          })
          admitted++
        }
      }
      console.log(`[dev/submit] Indexed ${admitted} outputs from tx ${txid}`)
      res.json({ status: 'ok', txid, admitted })
    } catch (err: any) {
      console.error('[dev/submit] error:', err)
      res.status(500).json({ error: err.message })
    }
  })

  // --- SSE hub ---

  const sseHub = new SSEHub()

  app.get('/api/games/:roomId/events', async (req, res) => {
    const { roomId } = req.params
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const cached = sseHub.getLastState(roomId)
    if (cached) {
      res.write(`data: ${JSON.stringify(cached)}\n\n`)
    } else {
      try {
        const game = await storage.findByTxid(roomId)
        if (game) res.write(`data: ${JSON.stringify(game)}\n\n`)
      } catch { /* ignore */ }
    }
    sseHub.subscribe(roomId, res)
    req.on('close', () => sseHub.unsubscribe(roomId, res))
  })

  app.post('/api/games/:roomId/broadcast', async (req, res) => {
    const { roomId } = req.params
    const game = req.body
    if (!game || !game.txid) {
      return res.status(400).json({ error: 'missing game state with txid' })
    }
    sseHub.broadcast(roomId, game)
    try {
      await storage.upsertGame({
        txid: game.txid,
        outputIndex: game.outputIndex ?? 0,
        playerX: game.playerX || '',
        playerO: game.playerO || '',
        board: game.board || '000000000',
        turn: game.turn ?? 0,
        status: game.status ?? 0,
        betAmount: game.betAmount ?? 0,
        satoshis: game.satoshis ?? 0,
        lockingScript: game.lockingScript || '',
        createdAt: new Date(game.createdAt || Date.now()),
        updatedAt: new Date(),
      })
    } catch (err: any) {
      console.warn('[broadcast] DB persist failed:', err.message)
    }
    res.json({ txid: game.txid, roomId, game })
  })

  app.post('/api/identity', async (req, res) => {
    try {
      const { txid, derivedPubkey, identityKey } = req.body
      if (!txid || !derivedPubkey || !identityKey) {
        return res.status(400).json({ error: 'missing txid, derivedPubkey, or identityKey' })
      }
      const game = await storage.findByTxid(txid)
      if (!game) return res.status(404).json({ error: 'game not found' })
      let field: 'identityKeyX' | 'identityKeyO'
      if (game.playerX === derivedPubkey) field = 'identityKeyX'
      else if (game.playerO === derivedPubkey) field = 'identityKeyO'
      else return res.status(403).json({ error: 'pubkey is not a player in this game' })
      await storage.setIdentityKey(txid, field, identityKey)
      console.log(`[identity] Set ${field} for game ${txid}`)
      res.json({ ok: true })
    } catch (err: any) {
      console.error('[identity] error:', err)
      res.status(500).json({ error: err.message })
    }
  })

  app.listen(PORT, () => {
    console.log(`TicTacToe Overlay running on port ${PORT} [REGTEST]`)
    console.log(`  Regtest RPC: ${RPC_URL}`)
    console.log(`  Dev submit:  POST http://localhost:${PORT}/dev/submit`)
    console.log(`  REST API:    http://localhost:${PORT}/api/games`)
  })
}

// ---------------------------------------------------------------------------
// Production mode: full overlay engine with knex, GASP, chain tracker, etc.
// ---------------------------------------------------------------------------
async function mainProduction() {
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

  server.configureTopicManager('tm_tictactoe', new TicTacToeTopicManager())
  server.configureLookupService('ls_tictactoe', new TicTacToeLookupService(storage))
  server.configureEnableGASPSync(false)
  server.configureChainTracker(
    new WhatsOnChain('main', { httpClient: new FetchHttpClient(fetch) })
  )

  await server.configureEngine()

  const engine = (server as any).engine
  engine.advertiser = undefined
  engine.broadcaster = undefined

  // Monkey-patch engine.submit to convert EF → BEEF before processing.
  const origSubmit = engine.submit.bind(engine)
  engine.submit = async function (taggedBEEF: any, ...args: any[]) {
    if (taggedBEEF && Array.isArray(taggedBEEF.beef) && taggedBEEF.beef[0] === 0x00) {
      try {
        const tx = Transaction.fromEF(taggedBEEF.beef)
        taggedBEEF.beef = tx.toBEEF(true)
        console.log(`[submit] Converted EF → BEEF for tx ${tx.id('hex')}`)
      } catch (err: any) {
        console.warn('[submit] EF→BEEF conversion failed:', err.message)
      }
    }
    return origSubmit(taggedBEEF, ...args)
  }

  // Register custom routes BEFORE server.start()
  const app = (server as any).app
  if (app) {
    app.use('/api', express.json())

    app.use('/api', (req: any, res: any, next: any) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Content-Type')
      if (req.method === 'OPTIONS') return res.sendStatus(204)
      next()
    })
    app.use('/stats', (_req: any, res: any, next: any) => {
      res.header('Access-Control-Allow-Origin', '*')
      next()
    })

    app.get('/api/games', async (req: any, res: any) => {
      try {
        const { games } = await storage.findOpenGames(1, 50)
        res.json(games)
      } catch (err: any) { res.status(500).json({ error: err.message }) }
    })

    app.get('/api/games/by-player/:pubkey', async (req: any, res: any) => {
      try {
        const { games } = await storage.findByPlayer(req.params.pubkey, 1, 50)
        res.json(games)
      } catch (err: any) { res.status(500).json({ error: err.message }) }
    })

    app.get('/api/games/:txid', async (req: any, res: any) => {
      try {
        const game = await storage.findByTxid(req.params.txid)
        if (!game) return res.status(404).json({ error: 'not found' })
        res.json(game)
      } catch (err: any) { res.status(500).json({ error: err.message }) }
    })

    app.get('/api/tx/:txid/hex', async (req: any, res: any) => {
      try {
        if (engine?.managers) {
          for (const mgr of Object.values(engine.managers) as any[]) {
            if (mgr?.storage?.findOutput) {
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
        try {
          const wocResp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${req.params.txid}/hex`)
          if (wocResp.ok) {
            const hex = await wocResp.text()
            res.type('text/plain').send(hex)
            return
          }
        } catch { /* fall through */ }
        res.status(404).send('not found')
      } catch (err: any) { res.status(500).send(err.message) }
    })

    app.get('/stats', async (_req: any, res: any) => {
      try {
        const games = await storage.count()
        res.json({ games })
      } catch { res.status(500).json({ games: 0 }) }
    })

    const sseHub = new SSEHub()

    app.get('/api/games/:roomId/events', async (req: any, res: any) => {
      const { roomId } = req.params
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      })
      const cached = sseHub.getLastState(roomId)
      if (cached) {
        res.write(`data: ${JSON.stringify(cached)}\n\n`)
      } else {
        try {
          const game = await storage.findByTxid(roomId)
          if (game) res.write(`data: ${JSON.stringify(game)}\n\n`)
        } catch { /* ignore */ }
      }
      sseHub.subscribe(roomId, res)
      req.on('close', () => sseHub.unsubscribe(roomId, res))
    })

    app.post('/api/games/:roomId/broadcast', async (req: any, res: any) => {
      const { roomId } = req.params
      const game = req.body
      if (!game || !game.txid) {
        return res.status(400).json({ error: 'missing game state with txid' })
      }
      sseHub.broadcast(roomId, game)
      try {
        await storage.upsertGame({
          txid: game.txid,
          outputIndex: game.outputIndex ?? 0,
          playerX: game.playerX || '',
          playerO: game.playerO || '',
          board: game.board || '000000000',
          turn: game.turn ?? 0,
          status: game.status ?? 0,
          betAmount: game.betAmount ?? 0,
          satoshis: game.satoshis ?? 0,
          lockingScript: game.lockingScript || '',
          createdAt: new Date(game.createdAt || Date.now()),
          updatedAt: new Date(),
        })
      } catch (err: any) {
        console.warn('[broadcast] DB persist failed:', err.message)
      }
      res.json({ txid: game.txid, roomId, game })
    })

    app.post('/api/identity', async (req: any, res: any) => {
      try {
        const { txid, derivedPubkey, identityKey } = req.body
        if (!txid || !derivedPubkey || !identityKey) {
          return res.status(400).json({ error: 'missing txid, derivedPubkey, or identityKey' })
        }
        const game = await storage.findByTxid(txid)
        if (!game) return res.status(404).json({ error: 'game not found' })
        let field: 'identityKeyX' | 'identityKeyO'
        if (game.playerX === derivedPubkey) field = 'identityKeyX'
        else if (game.playerO === derivedPubkey) field = 'identityKeyO'
        else return res.status(403).json({ error: 'pubkey is not a player in this game' })
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

// ---------------------------------------------------------------------------
;(IS_REGTEST ? mainRegtest() : mainProduction()).catch(err => {
  console.error('Overlay failed to start:', err)
  process.exit(1)
})
