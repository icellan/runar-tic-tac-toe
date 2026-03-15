# Tic-Tac-Toe on BSV

A multiplayer Tic-Tac-Toe game where every move is an on-chain Bitcoin SV transaction, powered by [Runar](https://github.com/icellan/runar) stateful smart contracts. Players use BRC-100 wallets to fund games, make moves, and settle bets — all enforced by Bitcoin Script.

```
┌─────────────────────────────────────────────────────────────────┐
│                          Architecture                           │
│                                                                 │
│  ┌─────────┐   HTTP/SSE   ┌──────────┐   REST   ┌───────────┐   │
│  │ Browser │◄────────────►│ Go       │◄────────►│ Overlay   │   │
│  │ (React) │              │ Backend  │          │ Service   │   │
│  └────┬────┘              └──────────┘          └─────┬─────┘   │
│       │                                               │         │
│       │  BRC-100 wallet                          MongoDB        │
│       │  + ARC broadcast                              │         │
│       ▼                                               ▼         │
│  ┌─────────┐                                   ┌───────────┐    │
│  │   BSV   │──── new blocks/txs ──────────────►│  Overlay  │    │
│  │ Network │                                   │  Engine   │    │
│  └─────────┘                                   └───────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

**The smart contract is the single source of truth.** The frontend handles all contract interactions directly via `runar-sdk`. The overlay service watches the blockchain, identifies TicTacToe transactions, and indexes game state in MongoDB. The Go backend is a thin relay: it queries the overlay for game state and pushes real-time updates to browsers via SSE.

---

## How the Overlay Works

The overlay service is the bridge between the blockchain and the application. It runs as a BSV Overlay Network node using `@bsv/overlay-express`.

### Data Flow

1. **Player makes a move** — the frontend builds a transaction via `runar-sdk`, the BRC-100 wallet signs it, and it's broadcast to the BSV network via ARC. The SDK also submits the transaction to the overlay for indexing.

2. **Overlay receives the transaction** — the `TicTacToeTopicManager` inspects each output. It uses `matchesArtifact()` from `runar-sdk` to check if the output's locking script matches the compiled TicTacToe contract.

3. **Overlay indexes the game state** — the `TicTacToeLookupService` deserializes the contract state (board, turn, status, players) from the OP_RETURN data using `deserializeState()`, and extracts constructor args (playerX, betAmount) using `extractConstructorArgs()`. This is stored in MongoDB.

4. **Go backend queries the overlay** — when browsers request game lists or game state, the Go backend fetches from the overlay's REST API and relays via SSE for real-time updates.

### Overlay Components

| File | Purpose |
|------|---------|
| `overlay/src/index.ts` | Starts the overlay server, registers topic manager and lookup service, exposes REST endpoints |
| `overlay/src/TicTacToeTopicManager.ts` | Identifies TicTacToe contract outputs in new transactions using `matchesArtifact()` |
| `overlay/src/TicTacToeLookupService.ts` | Deserializes contract state from on-chain scripts, stores in MongoDB |
| `overlay/src/TicTacToeStorage.ts` | MongoDB CRUD for game records |
| `overlay/src/artifact.ts` | Loads the compiled contract artifact (single source of truth for state fields, constructor slots) |

### Why an Overlay?

Smart contract state lives on-chain in UTXOs, but querying the blockchain directly for "all open games" or "games by player" would require scanning every UTXO. The overlay watches the chain, identifies contract outputs, and maintains a queryable index — turning on-chain data into a REST API.

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
        api.ts                      # Backend HTTP client
        game-logic.ts               # Move analysis (method selection)
        wallet.ts                   # BRC-100 wallet integration
        wallet-provider.ts          # SDK provider + artifact config
        types.ts                    # TypeScript interfaces
      pages/                        # LandingPage, GamePage, MyGamesPage
  overlay/
    src/
      index.ts                      # Overlay server entry point
      TicTacToeTopicManager.ts      # Identifies contract outputs on-chain
      TicTacToeLookupService.ts     # Deserializes and indexes game state
      TicTacToeStorage.ts           # MongoDB game storage
      artifact.ts                   # Shared compiled artifact loader
  main.go                           # Go HTTP server, API routes, SPA serving
  game.go                           # Overlay REST client, game data types
  sse.go                            # Server-Sent Events hub
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
  +-- UTXO: [betAmount] locked by contract (status=0, empty board)
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

React + TypeScript SPA built with Vite. All contract interactions happen in the browser via `runar-sdk`.

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

## Backend Architecture

### Go Backend (main.go, game.go, sse.go)

The Go backend is a thin relay between the browser and the overlay service. It has no knowledge of the contract, the compiler, or Bitcoin Script.

**What it does:**
- Queries the overlay REST API for game state
- Pushes real-time updates via SSE so opponents see moves instantly
- Serves the frontend as embedded static files

**What it does NOT do:** compile contracts, build transactions, validate moves, or talk to BSV nodes.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/games` | List open public games (via overlay) |
| GET | `/api/games/mine?pubkey=` | List player's games (via overlay) |
| GET | `/api/games/:id` | Get game state (via overlay) |
| POST | `/api/games/:id/broadcast` | Record action, push SSE update |
| GET | `/api/games/:id/prepare` | Return contract UTXO info for spending |
| GET | `/api/games/:id/events` | SSE stream for live updates |

---

## Running the Project

### Prerequisites

- Go 1.22+
- Node.js 18+
- MongoDB (for overlay storage)
- BRC-100 desktop wallet at localhost:3321
- Runar monorepo (sibling directory, built)

### Expected Directory Layout

```
gitcheckout/
  runar/               # Runar monorepo (cloned and built)
  runar-tic-tac-toe/   # This project
```

### Build & Run

```bash
# 1. Build Runar packages
cd ../runar
pnpm install && pnpm build

# 2. Start MongoDB
mongod --dbpath ./data/db

# 3. Start the overlay service
cd overlay
cp .env.example .env    # edit with your overlay private key and MongoDB URI
npm install
npm run dev             # runs on :8081

# 4. Build and start the Go backend
cd ..
cd frontend && npm install && npm run codegen && npm run build && cd ..
go build -o tic-tac-toe .
./tic-tac-toe           # runs on :8080

# 5. (Development) Run frontend with hot reload instead of step 4's build
cd frontend
npm run dev             # Vite dev server, proxies /api to :8080
```

### Environment Variables

| Variable | Default | Where | Description |
|----------|---------|-------|-------------|
| `PORT` | `8080` | Go backend | HTTP server port |
| `OVERLAY_URL` | `http://localhost:8081` | Go backend | Overlay service URL |
| `VITE_OVERLAY_URL` | `http://localhost:8081` | Frontend | Overlay URL (for identity key registration) |
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

**Smart contract as single source of truth:** The contract enforces all game rules on-chain. The overlay indexes state, the Go backend relays it, but neither validates moves. If the contract rejects a move, the transaction fails to broadcast.

**Overlay for indexing, not logic:** The overlay watches the blockchain and deserializes contract state into a queryable database. It uses the compiled artifact's metadata (`stateFields`, `constructorSlots`) to extract state generically — no hardcoded byte offsets.

**Frontend-driven contract interactions:** The frontend builds transactions and calls contract methods directly via `runar-sdk`. The backend never touches Bitcoin Script.

**Generated typed contract:** `runar codegen` generates a `TicTacToeContract` class with typed methods, `fromUtxo()` for reconnection, and `deployWithWallet()` for BRC-100 wallet deployment.

**SDK does the heavy lifting:** The app uses SDK-provided `WalletProvider` (ARC broadcasting, EF format, overlay submission, UTXO management), `WalletSigner` (key derivation, signing), `matchesArtifact()` (contract identification), `extractConstructorArgs()` (constructor extraction), and `estimateCallFee()` (fee estimation). The app code stays thin.
