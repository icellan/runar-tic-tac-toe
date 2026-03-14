# Tic-Tac-Toe on BSV

A multi-user Tic-Tac-Toe web app where game state lives on-chain via [Runar](https://github.com/icellan/runar) stateful smart contracts. Players use BRC-100 wallets to fund games, make moves (each move = on-chain tx), and settle bets.

```
┌──────────────────────────────────────────────────────────────┐
│                        Architecture                          │
│                                                              │
│  ┌─────────┐    HTTP/SSE    ┌─────────┐                     │
│  │ Browser │ ◄────────────► │   Go    │                     │
│  │ (React) │                │ Backend │  (state/sync only)  │
│  └────┬────┘                └─────────┘                     │
│       │                         │                           │
│       │  localhost:3321         │  SQLite                   │
│       ▼                         ▼                           │
│  ┌─────────┐              ┌──────────┐                      │
│  │ BRC-100 │              │ tictactoe│                      │
│  │ Wallet  │              │   .db    │                      │
│  └────┬────┘              └──────────┘                      │
│       │                                                     │
│       │  ARC broadcast                                      │
│       ▼                                                     │
│  ┌─────────┐                                                │
│  │   BSV   │                                                │
│  │ Network │                                                │
│  └─────────┘                                                │
└──────────────────────────────────────────────────────────────┘
```

The **smart contract is the single source of truth**. The frontend handles all contract interactions directly via `runar-sdk` — compiling locking scripts, building transactions, calling contract methods. The Go backend is a thin state/sync server: it indexes games in SQLite and pushes real-time updates via SSE. It has zero knowledge of the contract, the compiler, or Bitcoin Script.

---

## Project Structure

```
runar-tic-toc/
  contract/
    TicTacToe.runar.ts          # Smart contract source
    TicTacToe.test.ts           # Contract test suite (vitest)
  frontend/
    src/
      generated/
        TicTacToe.runar.json    # Compiled artifact (runar compile)
        TicTacToeContract.ts    # Typed wrapper class (runar codegen)
      components/               # React UI components
      hooks/                    # useWallet, useGame, useGameList
      lib/
        api.ts                  # Backend HTTP client
        game-contract.ts        # Load typed contract from chain
        game-logic.ts           # Move analysis (method selection)
        wallet.ts               # BRC-100 wallet integration
        types.ts                # TypeScript interfaces
      pages/                    # LandingPage, GamePage, MyGamesPage
    package.json                # npm run codegen
  main.go                       # HTTP server, API routes, SPA serving
  game.go                       # SQLite schema, game CRUD, board helpers
  sse.go                        # Server-Sent Events hub
  go.mod                        # Single dependency: go-sqlite3
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

The contract uses property initializers to set default values. Only `playerX` and `betAmount` are constructor parameters — everything else has a default.

| Field | Type | Mutable | Default | Description |
|-------|------|---------|---------|-------------|
| `playerX` | PubKey | No | *(constructor)* | Game creator |
| `betAmount` | bigint | No | *(constructor)* | Satoshis each player stakes |
| `p2pkhPrefix` | ByteString | No | `1976a914` | P2PKH output prefix |
| `p2pkhSuffix` | ByteString | No | `88ac` | P2PKH output suffix |
| `playerO` | PubKey | Yes | zero-key | Opponent (set on join) |
| `c0`-`c8` | bigint | Yes | `0` | Board cells |
| `turn` | bigint | Yes | `0` | Whose turn (1=X, 2=O) |
| `status` | bigint | Yes | `0` | 0=waiting, 1=playing |

### Methods

| Method | Type | Purpose |
|--------|------|---------|
| `join(opponentPK, sig)` | State-mutating | Player O joins; sets playerO, status=1, turn=1 |
| `move(position, player, sig)` | State-mutating | Non-terminal move; validates turn, updates cell, flips turn |
| `moveAndWin(position, player, sig)` | Terminal | Winning move; validates win, enforces winner-gets-all payout |
| `moveAndTie(position, player, sig)` | Terminal | Tie move; validates board full + no win, enforces equal split |
| `cancelBeforeJoin(sig)` | Terminal | Creator cancels before anyone joins; full refund |
| `cancel(sigX, sigO)` | Terminal | Both players cancel; enforces equal refund |

**State-mutating** methods produce a continuation UTXO with the same locking script and updated OP_RETURN state. The Runar compiler auto-injects `checkPreimage` at entry and state serialization at exit.

**Terminal** (non-mutating) methods spend the UTXO without creating a continuation. They enforce payout outputs via `extractOutputHash` + `hash256` — the contract computes the expected output hash and asserts it matches what's in the sighash preimage.

### Signature Pattern

`Sig` is an affine type in Runar — it can only be consumed once (by `checkSig`). This means you can't use the same sig in two branches of an if/else. Each method takes the caller's pubkey (`player`) as a separate argument, verifies the signature against it with a single `checkSig`, then asserts the pubkey matches the expected player for the current turn.

### Win Detection

The `checkWinAfterMove` helper simulates placing a mark at the given position and checks all 8 winning lines explicitly:

```
Rows:  (0,1,2)  (3,4,5)  (6,7,8)
Cols:  (0,3,6)  (1,4,7)  (2,5,8)
Diags: (0,4,8)  (2,4,6)
```

It uses `getCellOrOverride` to read cell values with one cell overridden — this avoids mutating state in terminal methods where no continuation UTXO is produced.

### Output Enforcement

For terminal methods (`moveAndWin`, `moveAndTie`, `cancel`), the contract constructs the expected transaction outputs in script, computes `hash256(outputs)`, and compares it to `extractOutputHash(txPreimage)`. This ensures the spending transaction distributes funds exactly as the contract specifies.

**Win payout:**
```
output = [totalPayout (8 LE)] [p2pkhPrefix] [hash160(winnerPubKey)] [p2pkhSuffix]
assert(hash256(output) == extractOutputHash(preimage))
```

**Tie/Cancel split:**
```
out1 = [betAmount (8 LE)] [p2pkhPrefix] [hash160(playerX)] [p2pkhSuffix]
out2 = [betAmount (8 LE)] [p2pkhPrefix] [hash160(playerO)] [p2pkhSuffix]
assert(hash256(out1 || out2) == extractOutputHash(preimage))
```

### OP_PUSH_TX and State Persistence

OP_PUSH_TX is the mechanism that makes stateful contracts possible on Bitcoin. A well-known keypair (private key = 1) signs the BIP-143 sighash preimage. The contract verifies this signature, which proves the preimage is authentic. From the verified preimage, the contract can extract:
- **hashOutputs** — to enforce what outputs the spending tx must have
- **scriptCode** — to verify the contract's own code hasn't changed

For state-mutating methods, the compiler generates code that serializes updated state fields into an OP_RETURN output and includes it in the continuation UTXO, ensuring state persists across transactions.

---

## Transaction Lifecycle

A complete game produces this chain of transactions:

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
Move TX #2 (Player O)
  +-- UTXO: [2x betAmount] locked by contract (turn=X, c4=1, c0=2)
       |
       v
  ... more moves ...
       |
       v
Terminal TX (moveAndWin / moveAndTie)
  +-- P2PKH output(s): funds distributed to winner(s)
```

Each non-terminal transaction spends the previous UTXO and creates a new one with the same locking script but updated state. The final terminal transaction has no contract continuation — just payout outputs.

---

## Codegen Pipeline

The frontend uses a **generated typed contract class** instead of hand-crafted `contract.call()` strings. The pipeline:

```bash
cd frontend
npm run codegen
```

This runs two steps:

1. **`runar compile`** — compiles `contract/TicTacToe.runar.ts` to `src/generated/TicTacToe.runar.json` (the artifact containing ABI, script, state fields)
2. **`runar codegen`** — generates `src/generated/TicTacToeContract.ts` from the artifact, providing type-safe method signatures

The generated `TicTacToeContract` class wraps `RunarContract` with typed methods:

```typescript
contract.move(position, player, options?)         // state-mutating
contract.join(opponentPK, options?)               // state-mutating
contract.moveAndWin(position, player, outputs)    // terminal
contract.moveAndTie(position, player, outputs)    // terminal
contract.cancelBeforeJoin(outputs)                // terminal
contract.cancel(outputs)                          // terminal
```

The artifact JSON is imported directly by the frontend at build time — no server endpoint needed.

---

## Frontend Architecture

React + TypeScript SPA built with Vite. All contract interactions happen in the browser via `runar-sdk`.

### Pages

| Path | Component | Description |
|------|-----------|-------------|
| `/` | LandingPage | Open challenges list, "New Game" button |
| `/game/:id` | GamePage | Board, player badges, bet display, move log |
| `/my-games` | MyGamesPage | Active + completed games for the connected wallet |

### Key Components

- **GameBoard** — 300x300 SVG with grid lines, X/O marks, hover states, and animated win line
- **GameCell** — Individual cell with X (coral) or O (cyan) mark, scale-in animation
- **WinLine** — SVG line overlay with draw animation across winning cells
- **CreateGameModal** — Form for bet amount and public/private toggle
- **PlayerBadge** — Player identity with turn indicator
- **BetDisplay** — Pot amount with accent styling

### Game Logic (Frontend)

The frontend determines which contract method to call for each move (`game-logic.ts`):

1. Simulates the move on the current board
2. Checks for win (all 8 lines) -> `moveAndWin`
3. Checks for full board -> `moveAndTie`
4. Otherwise -> `move`

This means the backend has no move validation logic — the smart contract is the single source of truth.

### Contract Interactions

All contract calls use the generated `TicTacToeContract`:

- **Create game**: `new TicTacToeContract(artifact, { playerX, betAmount })` -> `getLockingScript()` -> wallet funds the UTXO
- **Join**: `contract.join(null, { satoshis: betAmount * 2 })`
- **Move**: `contract.move(position, null, { satoshis })` / `contract.moveAndWin(...)` / `contract.moveAndTie(...)`
- **Cancel before join**: `contract.cancelBeforeJoin([{ address, satoshis }])`
- **Cancel (both players)**: Coordinated via backend — each player signs the sighash independently

The SDK's `WalletSigner` handles all wallet communication. For `Sig` and `PubKey` params, passing `null` tells the SDK to auto-resolve them from the connected signer.

### Wallet Integration

The frontend connects to a BRC-100 desktop wallet at `localhost:3321`:

1. `useWallet` hook polls for connectivity and fetches identity key
2. `WalletSigner` from `runar-sdk` handles key derivation and signing
3. The SDK's `call()`/`deploy()` methods handle the full tx lifecycle: build -> sign via wallet -> broadcast via provider

---

## Backend Architecture

The Go backend is a pure **state/sync server**. It has no knowledge of the contract, the compiler, or Bitcoin Script. Its only dependency is `go-sqlite3`.

### Files

| File | Purpose |
|------|---------|
| `main.go` | HTTP server, API routes, CORS, SPA fallback |
| `game.go` | SQLite schema, game CRUD, cancel proposals, board helpers |
| `sse.go` | Server-Sent Events hub for real-time updates |

### What the Backend Does

- **Indexes games** in SQLite for fast lookup by ID, player, or status
- **Records actions** from the frontend after the wallet broadcasts (create, join, move, win, tie, cancel)
- **Pushes real-time updates** via SSE so opponents see moves instantly
- **Coordinates two-player cancel** — stores sighash + signatures from each player
- **Serves the frontend** as embedded static files

### What the Backend Does NOT Do

- Compile contracts
- Build transactions
- Validate moves
- Talk to BSV nodes
- Handle wallets or signing

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/games` | List open public games |
| GET | `/api/games/mine?pubkey=` | List player's games |
| GET | `/api/games/:id` | Get game state |
| POST | `/api/games/:id/broadcast` | Record completed action, update index |
| GET | `/api/games/:id/prepare` | Return contract UTXO info for spending |
| POST | `/api/games/:id/cancel/propose` | Propose mutual cancellation |
| GET | `/api/games/:id/cancel` | Get cancel proposal status |
| POST | `/api/games/:id/cancel/approve` | Submit sighash + approver signature |
| POST | `/api/games/:id/cancel/sign` | Submit proposer signature |
| GET | `/api/games/:id/events` | SSE stream for live updates |

### SQLite Schema

Games are indexed in SQLite for fast lookup. The board is stored as a 9-character string (`"000000000"`). Status codes: 0=waiting, 1=playing, 2=X wins, 3=O wins, 4=tie, 5=cancelled.

### Real-Time Updates

SSE hub pattern: each game ID has a set of connected clients. When `/broadcast` succeeds, the hub pushes the new game state to all watchers. Opponents see moves appear in real-time.

---

## Testing the Smart Contract

The contract has a comprehensive test suite using Runar's `TestContract` framework. Tests live in `contract/TicTacToe.test.ts` alongside the contract source.

### Prerequisites

The test suite resolves Runar packages from a sibling `runar` checkout. Expected directory layout:

```
gitcheckout/
  runar/           # Runar monorepo (built)
  runar-tic-toc/   # This project
```

Make sure the Runar packages are built:

```bash
cd ../runar
pnpm install
pnpm build
```

### Running Tests

```bash
cd contract
npm install
npm test
```

This runs `vitest` which compiles the contract through the Runar compiler pipeline and tests it using the `TestContract` API — a simulated execution environment that:

- Compiles the `.runar.ts` source to Bitcoin Script
- Initializes state with provided values
- Calls methods with arguments and mock signatures
- Verifies success/failure and inspects updated state

### Test Coverage

The test suite covers:

- **join**: successful join, rejection when already playing
- **move**: all 9 positions, turn flipping, occupied cell rejection, out-of-bounds rejection, sequential moves
- **moveAndWin**: row/column/diagonal wins for both players, rejection when not a win, cell occupied
- **moveAndTie**: full board tie, rejection when board not full
- **cancel**: dual-signature cancellation, single-player cancel before join
- **win detection**: all 8 winning lines explicitly tested
- **full game flow**: join through multiple sequential moves

---

## Running the Project

### Prerequisites

- Go 1.26+
- Node.js 18+
- BRC-100 desktop wallet at localhost:3321
- Runar monorepo (sibling directory, built)

### Build & Run

```bash
# Install frontend dependencies and generate typed contract
cd frontend
npm install
npm run codegen

# Build frontend (outputs to ../static/)
npm run build
cd ..

# Build and run Go server
go build -o tic-tac-toe .
./tic-tac-toe
```

Server starts at `http://localhost:8080`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `DB_PATH` | `tictactoe.db` | SQLite database path |

### Development

For frontend development with hot reload:

```bash
# Terminal 1: Go backend
go run .

# Terminal 2: Vite dev server (proxies /api to localhost:8080)
cd frontend
npm run dev
```

### Regenerating the Typed Contract

After modifying `contract/TicTacToe.runar.ts`:

```bash
cd frontend
npm run codegen
```

This recompiles the artifact and regenerates the typed `TicTacToeContract` class.

---

## Design Decisions

**Smart contract as single source of truth:** The contract enforces all game rules on-chain. The backend does no validation — it just indexes state. If the contract rejects a move, the transaction fails to broadcast. This means the backend can never get out of sync with the actual on-chain state.

**Frontend-driven contract interactions:** The frontend compiles locking scripts, builds transactions, and calls contract methods directly via `runar-sdk`. The backend never touches Bitcoin Script. This keeps the backend trivially simple (3 Go files, 1 dependency) and makes the frontend self-sufficient.

**Generated typed contract:** Instead of hand-crafting `contract.call('move', [position, player, ...])` strings, `runar codegen` generates a `TicTacToeContract` class with typed methods. This catches argument errors at compile time and makes the code readable.

**Artifact as static import:** The compiled artifact JSON is imported directly by the frontend at build time (`import artifact from './TicTacToe.runar.json'`). No server endpoint, no runtime fetch, no caching logic.

**Stateful contract over stateless:** Tic-Tac-Toe has shared mutable state (the board). A stateless approach would require passing the entire board state in each transaction's scriptSig, losing the on-chain enforcement guarantee. The stateful approach locks state in OP_RETURN data within the UTXO itself.

**9 individual fields over packed encoding:** While you could pack the board into a single bigint with bit operations, individual fields make the contract readable and each cell check is a simple equality comparison. BSV has no practical script size limit, so the verbosity is acceptable.

**Separate terminal methods (`moveAndWin`, `moveAndTie`) over a single `move`:** Terminal moves don't produce a continuation UTXO — they distribute funds. Mixing state-mutating and non-mutating logic in one method would complicate the compiler's auto-injected continuation code. Separate methods keep the distinction clean.

**Property initializers for defaults:** The contract uses `field: Type = defaultValue` syntax so only `playerX` and `betAmount` are constructor parameters. This reduces the generated constructor from 16 params to 2.

**SSE over WebSocket:** SSE is simpler, unidirectional (server->client), works through proxies, and auto-reconnects. Game updates flow one way (server pushes new state). The frontend sends moves via HTTP POST, not through the event stream.

**SQLite index over pure chain reads:** Reading the latest UTXO from the chain on every request would be slow and require scanning. SQLite provides instant game lookup by ID, player, or status. The backend updates the index on each broadcast, keeping it in sync.
