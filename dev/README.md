# Dev — Regtest Overlay Pipeline Testing

This directory contains a local development environment for debugging and testing
the overlay's transaction submission, indexing, and retrieval against a BSV regtest
node. It exercises the **full overlay pipeline** — the same code path production
transactions take — without any mainnet dependencies.

The production frontend is not modified. This test harness drives the overlay
directly from Node.js, using the generated `TicTacToeContract` class (same as
the frontend) with `RPCProvider` + `LocalSigner` instead of `WalletProvider` +
`WalletSigner`.


## What this tests

The production flow looks like this:

```
Browser (WalletProvider)
  │
  ├─ 1. ARC broadcast (EF format) ────────────────────► BSV mainnet
  │
  ├─ 2. POST /submit (EF bytes) ──► Overlay engine
  │                                     │
  │                                     ├─ EF→BEEF conversion (monkey-patch)
  │                                     ├─ TopicManager.identifyAdmissibleOutputs()
  │                                     │    └─ matchesArtifact() on each output
  │                                     ├─ LookupService.outputAdmittedByTopic()
  │                                     │    └─ deserializeState() → upsertGame() → MongoDB
  │                                     └─ ChainTracker.isValidRootForHeight()
  │                                          └─ WhatsOnChain merkle proof verification
  │
  └─ 3. POST /api/games/:id/broadcast ──► SSEHub + MongoDB (pre-indexing persistence)
```

The dev harness replaces the browser and mainnet with Node.js and regtest:

```
Node.js test (RPCProvider + LocalSigner)
  │
  ├─ 1. sendrawtransaction + auto-mine ────────────────► BSV regtest node
  │
  ├─ 2. POST /submit (EF bytes) ──► Overlay engine
  │                                     │
  │                                     ├─ EF→BEEF conversion (same monkey-patch)
  │                                     ├─ TopicManager.identifyAdmissibleOutputs()
  │                                     ├─ LookupService.outputAdmittedByTopic()
  │                                     └─ Permissive ChainTracker (always returns true)
  │
  ├─ 3. POST /api/games/:id/broadcast ──► SSEHub + MongoDB
  │
  └─ 4. GET /api/games/:id ◄──────────── Verify overlay indexed correctly
```

Every component in the overlay pipeline is exercised: the EF→BEEF conversion
patch, the `TicTacToeTopicManager` (artifact matching via `matchesArtifact()`),
the `TicTacToeLookupService` (state deserialization via `deserializeState()` +
`extractConstructorArgs()`), MongoDB persistence, the REST API, and raw
transaction retrieval via `/api/tx/:txid/hex`.


## Prerequisites

Three services must be running before you start:

### 1. BSV regtest node

A Bitcoin SV node running in regtest mode on `localhost:18332` with RPC
credentials `bitcoin:bitcoin`. The integration tests at `contract/integration/`
use the same node.

Start it with whatever method your setup uses (e.g., `./regtest.sh start` in the
Runar integration directory). The node must:

- Accept RPC connections on port 18332
- Have at least 101 blocks mined (for coinbase maturity — the startup script
  handles this automatically)
- Have sufficient wallet balance (at least 1 BTC — reset the chain if depleted)

### 2. MongoDB

Running on `localhost:27017`. The overlay stores game state in a `tictactoe`
database, collection `overlay_tictactoe`. The dev environment uses the same
database as the normal overlay — if you want isolation, set a different
`MONGODB_URI`.

### 3. Node.js dependencies

Run `npm install` in both `dev/` and `overlay/` if you haven't already.


## Quick start

```bash
# Terminal 1 — start overlay in regtest mode
cd dev
./start.sh

# Terminal 2 — run tests
cd dev
npm test
```

The `start.sh` script:
1. Verifies the regtest node is running and has enough blocks
2. Verifies MongoDB is running
3. Installs npm dependencies if missing (both `dev/` and `overlay/`)
4. Starts the overlay with `REGTEST=true` and hot-reload (`tsx watch`)
5. Prints the overlay URL and waits (Ctrl+C to stop)

Alternatively, start the overlay manually:

```bash
cd overlay
REGTEST=true \
  MONGODB_URI=mongodb://localhost:27017 \
  OVERLAY_PRIVATE_KEY=$(openssl rand -hex 32) \
  npm run dev:regtest
```


## Running tests

```bash
cd dev
npm test              # Single run
npm run test:watch    # Watch mode — re-runs on file changes
```

The test suite (`overlay-pipeline.test.ts`) covers:

| Test | What it verifies |
|------|-----------------|
| **deploy + indexing** | Deploy a game on regtest → submit to overlay → query via `GET /api/games/:txid` |
| **open games list** | Deployed game appears in `GET /api/games` |
| **raw tx retrieval** | `GET /api/tx/:txid/hex` returns valid parseable hex |
| **join + indexing** | Player O joins → overlay state updates (playerO set, status=1) |
| **full game to win** | Deploy → join → 4 moves → moveAndWin → overlay shows status=2 |
| **full game to tie** | Deploy → join → 8 moves → moveAndTie → overlay shows status=4 |
| **cancel before join** | Deploy → cancelBeforeJoin → overlay shows status=5 |
| **raw tx for moves** | Raw transaction hex is retrievable for mid-game move transactions |


## How it works

### Overlay regtest mode

The overlay (`overlay/src/index.ts`) checks `process.env.REGTEST === 'true'` and
makes two targeted changes:

1. **Permissive chain tracker** — replaces WhatsOnChain with
   `{ isValidRootForHeight: async () => true }`. On regtest, BEEF transactions
   don't have real merkle proofs, so the engine skips proof verification. The
   rest of the engine pipeline (TopicManager, LookupService) runs identically
   to production.

2. **Regtest RPC fallback for `/api/tx/:txid/hex`** — instead of falling back to
   WhatsOnChain when the overlay engine doesn't have a transaction, it calls
   `getrawtransaction` on the regtest node via JSON-RPC. This is the only other
   regtest-specific code path.

Everything else — the EF→BEEF monkey-patch, TopicManager, LookupService, MongoDB
storage, SSE hub, REST API — runs the exact same code as production.

### Test harness architecture

The test uses the **generated `TicTacToeContract` class** — the same wrapper the
frontend uses — imported directly from `frontend/src/generated/TicTacToeContract.ts`.
This ensures the dev harness exercises the exact same typed method signatures
(`deploy`, `join`, `move`, `moveAndWin`, etc.) as production.

The test creates two funded wallets (Player X and Player O) on regtest and plays
games through the overlay using the same three-step pattern the frontend uses:

**Step 1: Contract operation on chain**

```typescript
const contract = new TicTacToeContract(artifact, {
  playerX: playerX.pubKeyHex,
  betAmount: BigInt(5000),
});
contract.connect(provider, playerX.signer);
const { txid } = await contract.deploy({ satoshis: 5000 });
```

The `RPCProvider` broadcasts via `sendrawtransaction` and auto-mines a block.
This is the same generated contract class the frontend uses — just connected to
`RPCProvider` + `LocalSigner` instead of `WalletProvider` + `WalletSigner`.

For two-player games, `contract.connect()` switches the active signer before
each player's turn:

```typescript
contract.connect(provider, playerX.signer);
await contract.move(4n, null, { satoshis: 10000 });  // X moves

contract.connect(provider, playerO.signer);
await contract.move(0n, null, { satoshis: 10000 });  // O moves
```

**Step 2: Submit to overlay for engine indexing**

```typescript
const rawHex = await provider.getRawTransaction(txid);
const tx = Transaction.fromHex(rawHex);
await submitToOverlay(tx);
```

The `submitToOverlay()` helper sends the transaction in EF format to
`POST /submit` — the same endpoint the SDK's `WalletProvider` calls in
production. The overlay's monkey-patch converts EF→BEEF, then the engine
processes it through `TicTacToeTopicManager.identifyAdmissibleOutputs()` and
`TicTacToeLookupService.outputAdmittedByTopic()`, which deserializes the
on-chain state and writes it to MongoDB.

**Step 3: Broadcast game state via REST API**

```typescript
await broadcastGameState(txid, {
  txid, outputIndex: 0,
  playerX: playerX.pubKeyHex, playerO: '',
  board: '000000000', turn: 1, status: 0,
  betAmount: 5000, satoshis: 5000,
  lockingScript: contract.getLockingScript(),
  ...
});
```

This calls `POST /api/games/:roomId/broadcast` — the same endpoint the frontend
calls after every contract operation. It pushes the game state to the SSE hub
(for live browser updates) and persists to MongoDB (so the game is queryable
before the engine finishes indexing).

**Step 4: Verify**

```typescript
const game = await getGame(txid);
expect(game.status).toBe(0);
expect(game.board).toBe('000000000');
```

Queries `GET /api/games/:txid` to verify the overlay has the correct state.


## Directory structure

```
dev/
├── README.md                    # This file
├── start.sh                     # One-command startup script
├── package.json                 # Dependencies (runar-sdk, @bsv/sdk, vitest)
├── vitest.config.ts             # Test runner config with runar package aliases
├── setup.ts                     # Global setup: checks regtest + overlay availability
├── test-setup.ts                # Polyfills globalThis.crypto for @bsv/sdk
├── overlay-pipeline.test.ts     # Main test suite
└── helpers/
    ├── node.ts                  # Regtest RPC helpers (createProvider, mine, fund)
    ├── wallet.ts                # Test wallet creation (createFundedWallet)
    ├── compile.ts               # Contract compilation (compileContract)
    └── overlay.ts               # Overlay API helpers (submitToOverlay, getGame, ...)
```

### Helpers detail

**`helpers/node.ts`** — Creates an `RPCProvider` configured for regtest
(`localhost:18332`, `autoMine: true`). Also exposes raw `rpcCall()`, `mine()`,
`fundAddress()`, and `isNodeAvailable()` for setup tasks. Mirrors
`contract/integration/helpers/node.ts`.

**`helpers/wallet.ts`** — Generates random private keys, derives regtest
addresses (version byte `0x6f`), funds them via the node's wallet, and wraps
them in `ExternalSigner` (backed by `LocalSigner`). The `TestWallet` interface
provides `privKeyHex`, `pubKeyHex`, `pubKeyHash`, `address`, and `signer`.
Mirrors `contract/integration/helpers/wallet.ts`.

**`helpers/compile.ts`** — Compiles `contract/TicTacToe.runar.ts` into a
`RunarArtifact`. Uses the Runar compiler with source-level aliases (configured
in `vitest.config.ts`) so it always compiles from the latest contract source.

**`helpers/overlay.ts`** — HTTP helpers for the overlay REST API:

| Function | Endpoint | Description |
|----------|----------|-------------|
| `submitToOverlay(tx)` | `POST /submit` | Submit a transaction in EF format for engine indexing |
| `broadcastGameState(roomId, game)` | `POST /api/games/:id/broadcast` | Push game state to SSE + MongoDB |
| `getGame(txid)` | `GET /api/games/:txid` | Query a single game |
| `listGames()` | `GET /api/games` | List open games (status=0) |
| `getTxHex(txid)` | `GET /api/tx/:txid/hex` | Get raw transaction hex |


## Environment variables

All optional — defaults work for the standard local setup.

| Variable | Default | Used by | Description |
|----------|---------|---------|-------------|
| `RPC_URL` | `http://localhost:18332` | Tests + overlay | Regtest node RPC endpoint |
| `RPC_USER` | `bitcoin` | Tests + overlay | RPC username |
| `RPC_PASS` | `bitcoin` | Tests + overlay | RPC password |
| `MONGODB_URI` | `mongodb://localhost:27017` | Overlay | MongoDB connection string |
| `OVERLAY_URL` | `http://localhost:8081` | Tests | Overlay HTTP endpoint |
| `OVERLAY_PRIVATE_KEY` | (random) | Overlay | Node identity key (any 64-char hex) |
| `REGTEST` | `true` (set by start.sh) | Overlay | Enables regtest mode |


## Debugging workflow

The typical workflow for debugging overlay/tx issues:

1. **Start the environment** — `./start.sh` (or manually start overlay with
   `npm run dev:regtest` in the overlay directory)

2. **Reproduce the bug** — Write a test case in `overlay-pipeline.test.ts` that
   triggers the issue. The existing tests cover deploy, join, move, win, tie,
   and cancel — copy the closest one and modify.

3. **Run in watch mode** — `npm run test:watch`. Edit the overlay source code
   (`overlay/src/`) or the test and it re-runs automatically. The overlay also
   hot-reloads via `tsx watch`.

4. **Inspect overlay logs** — The overlay prints detailed logs:
   - `[submit] Converted EF → BEEF for tx <txid>` — EF→BEEF conversion
   - `[TicTacToeLookup] Indexed game <txid>:<index> status=<n> board=<board>` — successful indexing
   - `TicTacToeTopicManager: Failed to parse BEEF: <error>` — BEEF parsing failure

5. **Inspect MongoDB directly** — Connect with `mongosh`:
   ```
   use tictactoe
   db.overlay_tictactoe.find().sort({ updatedAt: -1 }).limit(5).pretty()
   ```

6. **Test raw tx retrieval** — `curl http://localhost:8081/api/tx/<txid>/hex`

7. **View in browser** — Optionally run `cd frontend && npm run dev` and open
   `http://localhost:5173`. Games created by the test harness will appear in the
   lobby (they're stored in the same MongoDB). This lets you visually verify
   the overlay state without modifying the frontend.


## How this relates to contract/integration/

The `contract/integration/` tests verify the **smart contract logic** — correct
state transitions, signature validation, payout enforcement — by calling contract
methods on regtest. The overlay is not involved.

This `dev/` harness verifies the **overlay pipeline** — that transactions are
correctly received, parsed (EF→BEEF), matched by the TopicManager, deserialized
by the LookupService, stored in MongoDB, and queryable via the REST API. The
contract is the same; the focus is different.

| | `contract/integration/` | `dev/` |
|---|---|---|
| **Tests** | Contract logic (state, sigs, payouts) | Overlay pipeline (submit, index, query) |
| **Contract class** | Raw `RunarContract` | Generated `TicTacToeContract` (same as frontend) |
| **Requires** | Regtest node | Regtest node + MongoDB + overlay |
| **Overlay** | Not used | Core focus |
| **Runs against** | RPCProvider → regtest | RPCProvider → regtest + overlay HTTP |
| **Helpers** | `helpers/node.ts`, `wallet.ts`, `compile.ts` | Same + `helpers/overlay.ts` |


## Overlay changes for regtest support

Only `overlay/src/index.ts` was modified, and all changes are gated behind
`process.env.REGTEST === 'true'` — production behavior is completely unchanged.

**1. Permissive chain tracker** (replaces WhatsOnChain):
```typescript
if (IS_REGTEST) {
  server.configureChainTracker({ isValidRootForHeight: async () => true })
}
```

**2. Regtest RPC fallback** (in `/api/tx/:txid/hex`, replaces WhatsOnChain fallback):
```typescript
if (IS_REGTEST) {
  const hex = await rpcCall('getrawtransaction', txid, false)
  // ...
}
```

**3. Regtest RPC helper** (top of file):
```typescript
async function rpcCall(method: string, ...params: unknown[]): Promise<unknown>
```

That's it. No new files in the overlay directory.
