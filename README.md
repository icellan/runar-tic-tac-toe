# Tic-Tac-Toe on BSV

A multiplayer Tic-Tac-Toe game where every move is an on-chain Bitcoin SV transaction, powered by [Runar](https://github.com/icellan/runar) stateful smart contracts. Players use BRC-100 wallets to fund games, make moves, and settle bets — all enforced by Bitcoin Script.

```
┌─────────────────────────────────────────────────────────────────┐
│                          Architecture                           │
│                                                                 │
│  ┌─────────┐  REST/SSE   ┌───────────┐                          │
│  │ Browser │◄───────────►│ Overlay   │                          │
│  │ (React) │             │ Service   │                          │
│  └────┬────┘             └─────┬─────┘                          │
│       │                        │                                │
│       │  BRC-100 wallet   MongoDB                               │
│       │                        │                                │
│       ├── ARC broadcast ──►  BSV Network  (mining)              │
│       └── /submit ────────►  Overlay Engine (indexing)          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**The smart contract is the single source of truth.** The frontend handles all contract interactions directly via `runar-sdk`. When a transaction is broadcast, the SDK submits it to both ARC (for mining) and the overlay's `/submit` endpoint (for indexing). The overlay identifies TicTacToe outputs, deserializes contract state into MongoDB, and serves a REST API plus SSE for real-time updates. The frontend is a static site (deployable to Cloudflare Pages) that talks directly to the overlay.

---

## How the Overlay Works

The overlay service is the bridge between the blockchain and the application. It runs as a BSV Overlay Network node using `@bsv/overlay-express`.

### Data Flow

There are two parallel paths: **indexing** (for persistent game state) and **real-time SSE** (for instant opponent updates).

#### Indexing path

1. **Player makes a move** — the frontend builds a transaction via `runar-sdk`, the BRC-100 wallet signs it, and it's broadcast to ARC (for mining). The SDK simultaneously submits the transaction to the overlay's `/submit` endpoint for indexing.

2. **Overlay receives the transaction** — the `TicTacToeTopicManager` inspects each output. It uses `matchesArtifact()` from `runar-sdk` to check if the output's locking script matches the compiled TicTacToe contract.

3. **Overlay indexes the game state** — the `TicTacToeLookupService` deserializes the contract state (board, turn, status, players) from the OP_RETURN data using `deserializeState()`, and extracts constructor args (playerX, betAmount) using `extractConstructorArgs()`. This is stored in MongoDB.

4. **Frontend queries the overlay** — browsers call the overlay's REST API for game lists and game state.

#### Real-time SSE path

1. **Both players subscribe to SSE** — when a player opens a game page, the frontend connects to `GET /api/games/:roomId/events` (where `roomId` is the game's creation txid). The overlay sends the latest cached state on connect.

2. **Player makes a move and broadcasts state** — after a successful contract call, the frontend constructs the new game state locally and POSTs it to `POST /api/games/:roomId/broadcast`.

3. **Overlay pushes to opponent** — the SSE hub relays the game state to all connected clients in that room. The opponent sees the move instantly, without waiting for the indexing path to complete.

### Overlay Components

| File | Purpose |
|------|---------|
| `overlay/src/index.ts` | Starts the overlay server, registers topic manager and lookup service, exposes REST + SSE endpoints |
| `overlay/src/SSEHub.ts` | In-memory pub/sub hub for real-time game updates via Server-Sent Events |
| `overlay/src/TicTacToeTopicManager.ts` | Identifies TicTacToe contract outputs in new transactions using `matchesArtifact()` |
| `overlay/src/TicTacToeLookupService.ts` | Deserializes contract state from on-chain scripts, stores in MongoDB |
| `overlay/src/TicTacToeStorage.ts` | MongoDB CRUD for game records |
| `overlay/src/artifact.ts` | Loads the compiled contract artifact (single source of truth for state fields, constructor slots) |

### Why an Overlay?

Smart contract state lives on-chain in UTXOs, but querying the blockchain directly for "all open games" or "games by player" would require scanning every UTXO. The overlay receives transactions via its `/submit` endpoint, identifies contract outputs, and maintains a queryable index — turning on-chain data into a REST API.

---

## Project Structure

```
runar-tic-tac-toe/
  contract/
    TicTacToe.runar.ts              # Smart contract source
    TicTacToe.test.ts               # Unit tests (vitest + TestContract)
    TicTacToe.debug.test.ts         # Debugger demo (ScriptVM step-through)
    integration/
      tictactoe.test.ts             # On-chain integration tests (regtest)
  frontend/
    src/
      generated/
        TicTacToe.runar.json        # Compiled artifact (runar compile)
        TicTacToeContract.ts        # Typed wrapper class (runar codegen)
      components/                   # React UI components
      hooks/                        # useWallet, useGame, useGameList, useDerivedKey, useCancelFlow
      lib/
        api.ts                      # Overlay HTTP client
        game-logic.ts               # Move analysis (method selection)
        wallet.ts                   # BRC-100 wallet integration
        wallet-provider.ts          # SDK provider + artifact config
        types.ts                    # TypeScript interfaces
      pages/                        # LandingPage, GamePage, MyGamesPage
    public/
      _redirects                    # Cloudflare Pages SPA routing
  overlay/
    src/
      index.ts                      # Overlay server entry point
      SSEHub.ts                     # In-memory SSE pub/sub hub
      TicTacToeTopicManager.ts      # Identifies contract outputs on-chain
      TicTacToeLookupService.ts     # Deserializes and indexes game state
      TicTacToeStorage.ts           # MongoDB game storage
      artifact.ts                   # Shared compiled artifact loader
```

---

## Smart Contract Design

### Why Stateful?

Tic-Tac-Toe has 9 cells, 2 players, and alternating turns — fundamentally stateful. The contract extends `StatefulSmartContract`, which uses OP_PUSH_TX to verify that the spending transaction correctly carries forward updated state in a new UTXO. Each move is a Bitcoin transaction that spends the previous contract UTXO and creates a new one with the updated board.

### Board Encoding

Since Runar (and Bitcoin Script) has no arrays, the 3x3 board uses 9 individual `bigint` fields (`c0`-`c8`):

```
 c0 | c1 | c2
----+----+----
 c3 | c4 | c5
----+----+----
 c6 | c7 | c8
```

Values: `0` = empty, `1` = X, `2` = O.

### State Fields

| Field | Type | Mutable | Default | Description |
|-------|------|---------|---------|-------------|
| `playerX` | PubKey | No | *(constructor)* | Game creator |
| `betAmount` | bigint | No | *(constructor)* | Satoshis each player stakes |
| `playerO` | PubKey | Yes | zero-key | Opponent (set on join) |
| `c0`-`c8` | bigint | Yes | `0` | Board cells |
| `turn` | bigint | Yes | `0` | Whose turn (1=X, 2=O) |
| `status` | bigint | Yes | `0` | 0=waiting, 1=playing |

### Methods

| Method | Type | Purpose |
|--------|------|---------|
| `join(opponentPK, sig)` | State-mutating | Player O joins; sets playerO, status=1, turn=1 |
| `move(position, player, sig)` | State-mutating | Non-terminal move; validates turn, updates cell, flips turn |
| `moveAndWin(position, player, sig, ...)` | Terminal | Winning move; validates win, enforces winner-gets-all payout |
| `moveAndTie(position, player, sig, ...)` | Terminal | Tie move; validates board full + no win, enforces equal split |
| `cancelBeforeJoin(sig, ...)` | Terminal | Creator cancels before anyone joins; full refund |
| `cancel(sigX, sigO, ...)` | Terminal | Both players cancel; enforces equal refund |

**State-mutating** methods produce a continuation UTXO with the same locking script and updated OP_RETURN state.

**Terminal** methods spend the UTXO without creating a continuation. They enforce payout outputs via `extractOutputHash` + `hash256`.

---

## Transaction Lifecycle

```
Deploy TX (Player X funds via wallet)
  +-- UTXO: [betAmount + fee margin] locked by contract (status=0, empty board)
       |
       v
Join TX (Player O funds additional betAmount)
  +-- UTXO: [2x betAmount] locked by contract (status=1, turn=X)
       |
       v
Move TX #1 (Player X)
  +-- UTXO: [2x betAmount] locked by contract (turn=O, c4=1)
       |
       v
  ... more moves ...
       |
       v
Terminal TX (moveAndWin / moveAndTie)
  +-- P2PKH output(s): funds distributed to winner(s)
```

Each transaction is submitted to both ARC (for mining) and the overlay service (for indexing).

---

## Debugging the Contract

The project includes two ways to debug contract execution:

### Interactive CLI Debugger

Compile the contract with source maps and launch the step-through debugger:

```bash
cd contract
npm run compile         # produces TicTacToe.runar.json with sourceMap
npm run debug:move      # debug a move() call interactively
npm run debug:join      # debug a join() call interactively
```

Debugger commands: `step` (s), `next` (n), `continue` (c), `stack` (st), `break` (b), `info` (i), `backtrace` (bt), `quit` (q).

### Programmatic Debugging in Tests

`contract/TicTacToe.debug.test.ts` demonstrates the `ScriptVM` API for stepping through execution in code:

```typescript
import { ScriptVM, SourceMapResolver, ALICE } from 'runar-testing';

const vm = new ScriptVM();
vm.loadHex(unlockingHex, lockingHex);

while (!vm.isComplete) {
  const result = vm.step();
  // Inspect result.opcode, result.mainStack, result.context
}
```

---

## Frontend Architecture

React + TypeScript SPA built with Vite. All contract interactions happen in the browser via `runar-sdk`. Deployable as a static site (e.g., Cloudflare Pages).

### Contract Interactions

All contract calls use the generated `TicTacToeContract`:

- **Create game**: `new TicTacToeContract(artifact, { playerX, betAmount })` -> `deployWithWallet({ satoshis })`
- **Load existing game**: `TicTacToeContract.fromUtxo(artifact, utxo)` -> `connect(provider, signer)`
- **Join**: `contract.join(null, { satoshis: betAmount * 2 })`
- **Move**: `contract.move(position, null, { satoshis })` / `contract.moveAndWin(...)` / `contract.moveAndTie(...)`
- **Cancel**: `contract.cancelBeforeJoin(...)` or coordinated `prepareCancel` / `finalizeCancel`

The SDK's `WalletSigner` handles all wallet communication. For `Sig` and `PubKey` params, passing `null` tells the SDK to auto-resolve them from the connected signer.

### Wallet Integration

The frontend connects to a BRC-100 desktop wallet. The SDK's `WalletProvider` handles UTXO management, EF-format broadcasting via ARC, and overlay transaction submission — all configured in `wallet-provider.ts`.

---

## API Endpoints (Overlay)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/submit` | Overlay protocol — submit a transaction for indexing |
| POST | `/lookup` | Overlay protocol — query the lookup service |
| GET | `/api/games` | List open public games |
| GET | `/api/games/by-player/:pubkey` | List player's games |
| GET | `/api/games/:txid` | Get game state |
| POST | `/api/games/:roomId/broadcast` | Relay game state to SSE subscribers |
| GET | `/api/games/:roomId/events` | SSE stream for live updates |
| POST | `/api/identity` | Register player identity key |
| GET | `/api/tx/:txid/hex` | Raw transaction hex lookup |
| GET | `/stats` | Game count |

---

## Running the Project

### Prerequisites

- Node.js 18+
- MongoDB (for overlay storage)
- BRC-100 desktop wallet at localhost:3321

### Build & Run

```bash
# 1. Start MongoDB
mongod --dbpath ./data/db

# 3. Start the overlay service
cd overlay
cp .env.example .env    # edit with your overlay private key and MongoDB URI
npm install
npm run dev             # runs on :8081

# 4. Start the frontend (development)
cd ../frontend
npm install
npm run codegen         # generate typed contract wrapper
npm run dev             # Vite dev server on :5173
```

### Production Build

```bash
cd frontend
npm run codegen && npm run build   # outputs to frontend/dist/
```

Deploy `frontend/dist/` to Cloudflare Pages (or any static host). Set `VITE_OVERLAY_URL` to the public overlay URL at build time (e.g., `https://tic-tac-toe-overlay.runar.run`).

### Environment Variables

| Variable | Default | Where | Description |
|----------|---------|-------|-------------|
| `VITE_OVERLAY_URL` | `http://localhost:8081` | Frontend (build-time) | Overlay URL for API calls and SSE (production: `https://tic-tac-toe-overlay.runar.run`) |
| `OVERLAY_PRIVATE_KEY` | *(required)* | Overlay | 64-char hex private key for overlay node identity |
| `MONGODB_URI` | *(required)* | Overlay | MongoDB connection string |
| `OVERLAY_HOSTING_URL` | `http://localhost:8081` | Overlay | Public URL where overlay is reachable |
| `OVERLAY_PORT` | `8081` | Overlay | Overlay service port |

---

## Testing

### Contract Unit Tests

```bash
cd contract
npm install
npm test              # 29 tests via TestContract (no blockchain needed)
```

### Contract Integration Tests

Requires a BSV regtest node running in Docker:

```bash
cd ../runar/integration
./regtest.sh start    # starts bitcoind in Docker

cd ../../runar-tic-tac-toe/contract/integration
npm install
npx vitest run        # 19 tests against live regtest node
```

### Debugger Tests

```bash
cd contract
npm run compile       # compile with source maps
npx vitest run TicTacToe.debug.test.ts
```

---

## Design Decisions

**Smart contract as single source of truth:** The contract enforces all game rules on-chain. The overlay indexes state but doesn't validate moves. If the contract rejects a move, the transaction fails to broadcast.

**No backend server:** The frontend is a static site that talks directly to the overlay service. The overlay handles both blockchain indexing and real-time SSE delivery. No intermediary server needed.

**Overlay for indexing + real-time:** The overlay receives transactions via `/submit`, deserializes contract state into a queryable database, and runs an in-memory SSE hub so players see opponent moves instantly.

**Frontend-driven contract interactions:** The frontend builds transactions and calls contract methods directly via `runar-sdk`. The overlay never touches Bitcoin Script.

**Generated typed contract:** `runar codegen` generates a `TicTacToeContract` class with typed methods, `fromUtxo()` for reconnection, and `deployWithWallet()` for BRC-100 wallet deployment.

**SDK does the heavy lifting:** The app uses SDK-provided `WalletProvider` (ARC broadcasting, EF format, overlay submission, UTXO management), `WalletSigner` (key derivation, signing), `matchesArtifact()` (contract identification), `extractConstructorArgs()` (constructor extraction), and `estimateCallFee()` (fee estimation). The app code stays thin.
