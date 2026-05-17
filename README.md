# Tic-Tac-Toe on BSV — a Runar example app

A complete, working multiplayer Tic-Tac-Toe game where every move is an on-chain Bitcoin SV transaction. Players use a BRC-100 wallet to fund games, sign moves, and settle bets — all enforced by [Runar](https://github.com/icellan/runar) stateful smart contracts compiled to Bitcoin Script.

This repository is intended as a **reference template** for building any stateful-contract BSV app. The code here is intentionally minimal: anything generic (overlay framework, React hooks, signed-envelope protocol, regtest harness) has been extracted into reusable packages. What remains is the game itself.

---

## What you'll learn by reading this code

- How to write a **stateful Bitcoin smart contract** in TypeScript using Runar.
- How to compile that contract and generate a typed client wrapper.
- How to run an **overlay indexer** (REST API + real-time SSE + MongoDB) for any Runar contract using [`runar-overlay-express`](https://github.com/icellan/runar-overlay-express).
- How to build a **React frontend** that drives the contract directly from the browser via [`runar-react`](https://github.com/icellan/runar-react) and [`runar-sdk`](https://github.com/icellan/runar) with a BRC-100 wallet.
- How to **sign and verify** off-chain state broadcasts so real-time updates can't be spoofed.
- How to **test** at three levels: contract unit tests (no chain), contract integration tests (regtest), overlay e2e tests (regtest + overlay process).
- How to **deploy** the frontend as a static site and the overlay as a Node service.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                Architecture                              │
│                                                                          │
│  ┌─────────┐    REST + SSE     ┌──────────────────┐                      │
│  │ Browser │◄─────────────────►│   Overlay        │                      │
│  │ (React) │                   │   Service        │                      │
│  └────┬────┘                   │  (runar-overlay- │                      │
│       │                        │   express)       │                      │
│       │                        └────┬─────────────┘                      │
│       │                             │                                    │
│       │  BRC-100 wallet         MongoDB (indexed contract UTXOs)         │
│       │                                                                  │
│       ├── ARC broadcast ───────►  BSV Network  (mining)                  │
│       │                                                                  │
│       └── POST /submit ────────►  Overlay engine (indexing)              │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**The smart contract is the single source of truth.** Every game rule is enforced on-chain by Bitcoin Script. The overlay only *indexes* what the chain accepts — it never validates moves itself.

When a player makes a move, the frontend builds the transaction via `runar-sdk`, the BRC-100 wallet signs it, and the SDK submits it to two destinations in parallel:

1. **ARC** — for mining onto the BSV chain.
2. **Overlay `/submit`** — for indexing into MongoDB.

The overlay receives the transaction, identifies the contract output via `matchesArtifact()`, deserializes the state, and stores it. Browsers query the overlay's REST API to get game lists or game state; they also subscribe to a per-game SSE stream so the opponent's moves appear instantly.

---

## Repository layout

```
runar-tic-tac-toe/
├── package.json            ← single root npm project; namespaced scripts
├── package-lock.json
├── README.md               ← this file
├── contract/               ← the Runar smart contract
│   ├── TicTacToe.runar.ts  ← contract source
│   ├── TicTacToe.test.ts   ← unit tests (vitest + TestContract) + ScriptVM debug demo
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── artifacts/          ← compiled artifact JSON (gitignored, produced by `runar compile`)
│   │   └── TicTacToe.runar.json
│   └── integration/        ← on-chain regtest tests (19 cases)
│       ├── tictactoe.test.ts
│       ├── setup.ts        ← vitest globalSetup + worker polyfill
│       └── vitest.config.ts
├── frontend/               ← React SPA (Vite)
│   ├── index.html
│   ├── public/             ← static assets served by Vite
│   │   └── _redirects      ← Cloudflare Pages SPA routing
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/     ← presentational UI (GameBoard, GameCell, WinLine, etc.)
│       ├── pages/          ← routed views (LandingPage, GamePage, MyGamesPage)
│       ├── hooks/          ← useGame, useGameList, useCancelFlow
│       ├── lib/            ← api.ts, game-logic.ts, types.ts, wallet.ts, wallet-provider.ts
│       ├── styles/global.css
│       └── generated/      ← `runar codegen` output
│           └── TicTacToeContract.ts
└── overlay/                ← overlay node service (Node + Express + MongoDB)
    ├── docker-compose.yml  ← production deploy stack
    ├── Dockerfile
    ├── tsconfig.json
    ├── vitest.regtest.config.ts
    ├── src/
    │   ├── index.ts        ← server bootstrap + app-specific routes (~180 LOC)
    │   ├── artifact.ts     ← loads compiled artifact JSON
    │   ├── TicTacToeLookupService.ts  ← thin GenericLookupService subclass
    │   └── TicTacToeStorage.ts        ← MongoDB schema + game-specific queries
    └── test/regtest/       ← overlay e2e tests (regtest + running overlay required)
        ├── pipeline.test.ts
        └── setup.ts
```

### Sibling repos (must be cloned alongside)

This project consumes three local packages via `file:` deps:

```
gitcheckout/
├── runar-tic-tac-toe/        ← this repo
├── runar/                    ← Runar monorepo (SDK, compiler, testing)
├── runar-overlay-express/    ← overlay framework
└── runar-react/              ← React hooks
```

All three siblings must be cloned and built before `npm install` here will succeed. See [Development workflow](#development-workflow) below.

---

## The Runar stack — which package does what

Building a Runar app means composing four packages plus your app code. Here's how responsibility is split:

| Concern | Provided by | This app's contribution |
|---|---|---|
| Stateful contract base class, type primitives (`PubKey`, `Sig`, `FixedArray`) | `runar-lang` | `TicTacToe.runar.ts` |
| Compile TS → Bitcoin Script artifact | `runar-compiler` (via `runar-cli`) | run `npm run contract:compile` |
| Generate typed client wrapper from artifact | `runar codegen` | run `npm run codegen` |
| Deploy + call contracts from browser, sign txs, broadcast | `runar-sdk` (`RunarContract`, `WalletProvider`, `WalletSigner`) | configure provider in `frontend/src/lib/wallet-provider.ts` |
| Identify contract outputs (`matchesArtifact`), decode state (`extractStateFromScript`) | `runar-sdk` | used inside the overlay package's `GenericLookupService` |
| Off-chain test VM, simulate methods, regtest helpers | `runar-testing` + `runar-overlay-express/regtest` | tests in `contract/` and `overlay/test/regtest/` |
| Overlay framework: SSE hub, topic manager factory, lookup service base class, route mounters, regtest/prod server bootstrap | `runar-overlay-express` | thin subclass + storage + 4 game-specific routes in `overlay/src/` |
| Signed broadcast envelope protocol (`signEnvelope` / `verifyEnvelope`) | `runar-sdk` (envelope module) | used by `frontend/src/lib/api.ts` and the overlay's broadcast route |
| React hooks: `useWallet`, `useDerivedKey`, `useSubscribedRecord`, `usePolledList`, `useMessageBoxPoller` | `runar-react` | composed in `frontend/src/hooks/*` and components |

**Rule of thumb:** if it isn't game-specific, it lives in a package, not in this repo. The pieces in this repo are the game rules (`TicTacToe.runar.ts`), the storage schema (`TicTacToeStorage.ts`), the lookup query types (`TicTacToeLookupService.ts`), the UI, and the wiring.

---

## Layer 1: the smart contract

### Source

`contract/TicTacToe.runar.ts` (~250 lines).

The contract extends `StatefulSmartContract` from `runar-lang`. State is stored in the locking script via OP_RETURN; the contract enforces that each move's continuation UTXO has correctly-updated state by hashing the spending transaction with OP_PUSH_TX.

### State

| Field | Type | Mutable | Default | Purpose |
|---|---|---|---|---|
| `playerX` | `PubKey` | No (constructor) | — | Game creator |
| `betAmount` | `bigint` | No (constructor) | — | Sats each player stakes |
| `playerO` | `PubKey` | Yes | zero-key (33 bytes of `00`) | Opponent (set on `join`) |
| `board` | `FixedArray<bigint, 9>` | Yes | all zeros | Cells: `0` = empty, `1` = X, `2` = O |
| `turn` | `bigint` | Yes | `0` | `0` = waiting for join, `1` = X to move, `2` = O to move |
| `status` | `bigint` | Yes | `0` | `0` = waiting, `1` = playing, `≥2` = terminal (`2` = X wins, `3` = O wins, `4` = tie, `5` = cancelled) |

The `FixedArray<bigint, 9>` board is desugared by the compiler's `expand-fixed-arrays` pass into nine sibling slots (`board__0`…`board__8`) at compile time. The SDK regroups them back into a JS array when decoding state with `extractStateFromScript`.

Board indexing:

```
 board[0] | board[1] | board[2]
----------+----------+----------
 board[3] | board[4] | board[5]
----------+----------+----------
 board[6] | board[7] | board[8]
```

### Methods

| Method | Type | Purpose |
|---|---|---|
| `join(opponentPK, sig)` | State-mutating | Player O enters; sets `playerO`, `status = 1`, `turn = 1` |
| `move(position, player, sig)` | State-mutating | Non-terminal move; validates turn, writes cell, flips turn |
| `moveAndWin(position, player, sig, changePKH, changeAmount, ...)` | Terminal | Winning move; validates the win line, enforces winner-takes-all payout |
| `moveAndTie(position, player, sig, changePKH, changeAmount, ...)` | Terminal | Tie move; validates board full + no win, enforces equal split |
| `cancelBeforeJoin(sig, changePKH, changeAmount, ...)` | Terminal | Creator refunds themselves before anyone joined |
| `cancel(sigX, sigO, changePKH, changeAmount, ...)` | Terminal | Both players coordinate cancel; equal refund |

**State-mutating** methods create a continuation UTXO with the same locking script and updated state.

**Terminal** methods don't create a continuation. They enforce specific payout outputs by hashing the spending transaction with `extractOutputHash` + `hash256` and asserting the result.

### Transaction lifecycle

```
Deploy TX  (Player X funds)
  └── UTXO[contract]  status=0, empty board, betAmount sats
        │
        ▼
Join TX  (Player O matches the bet)
  └── UTXO[contract]  status=1, turn=X, 2× betAmount sats
        │
        ▼
Move TX  (alternating X/O, non-terminal)
  └── UTXO[contract]  updated board + flipped turn
        │
        ▼ ... more moves ...
        │
        ▼
Terminal TX  (moveAndWin / moveAndTie / cancel*)
  └── P2PKH output(s)  funds distributed; no continuation
```

Every transaction is submitted to both ARC (for mining) and the overlay's `/submit` endpoint (for indexing).

---

## Layer 2: the overlay

The overlay is a Node service that indexes contract UTXOs into MongoDB and exposes a REST API + SSE for the frontend. It runs on `@bsv/overlay-express` with the generic plumbing supplied by [`runar-overlay-express`](https://github.com/icellan/runar-overlay-express).

### What `runar-overlay-express` provides

- `startOverlayServer(config)` — unified bootstrap for both `mode: 'regtest'` and `mode: 'production'`.
- `createTopicManager(artifact)` — admits transaction outputs that match the contract's locking script template (via `matchesArtifact`).
- `GenericLookupService<T>` — abstract base class that handles `outputAdmittedByTopic`, `outputSpent`, `outputEvicted`, `outputNoLongerRetainedInHistory`. App subclasses to provide `stateMapper`, `lookup(query)`, `getDocumentation`, `getMetaData`.
- `SSEHub` — in-memory pub/sub keyed by room ID, with last-state caching.
- `mountSSERoute`, `mountBroadcastRoute`, `mountTxHexRoute` — Express middleware for the standard endpoints.
- `mountDevSubmitRoute` — regtest-only debug endpoint that bypasses the overlay engine.
- Signed-envelope verification via `verifyEnvelope` from `runar-sdk`.

### What this app provides

Four files in `overlay/src/`:

- **`index.ts`** — wires everything together: env vars → `startOverlayServer` config + `registerRoutes` callback for the four app-specific REST endpoints + the `/api/identity` endpoint. ~180 LOC.
- **`artifact.ts`** — loads `contract/artifacts/TicTacToe.runar.json` from disk.
- **`TicTacToeLookupService.ts`** — `GenericLookupService<OverlayGame>` subclass. Defines a `stateMapper` (turns raw decoded state into an `OverlayGame` MongoDB record) and a `lookup` dispatcher that handles `findOpenGames` / `findByPlayer` / `findByTxid`. ~70 LOC.
- **`TicTacToeStorage.ts`** — MongoDB schema + queries. Implements `StorageInterface<OverlayGame>` plus game-specific methods. ~85 LOC.

### REST + SSE endpoints

| Method | Path | Provided by | Purpose |
|---|---|---|---|
| `POST` | `/submit` | `@bsv/overlay-express` engine | Standard overlay protocol submission |
| `POST` | `/lookup` | `@bsv/overlay-express` engine | Standard overlay protocol query |
| `POST` | `/dev/submit` | `runar-overlay-express/regtest` | Regtest-only: feed raw tx hex straight to the lookup service, bypass the engine |
| `GET` | `/api/games` | app | List open public games (`status === 0`) |
| `GET` | `/api/games/by-player/:pubkey` | app | List a player's games (either side) |
| `GET` | `/api/games/:txid` | app | Get a specific game by txid |
| `POST` | `/api/games/:roomId/broadcast` | `runar-overlay-express` (`mountBroadcastRoute`) | Verify signed envelope → push to SSE subscribers (and auto-persist to storage) |
| `GET` | `/api/games/:roomId/events` | `runar-overlay-express` (`mountSSERoute`) | SSE stream for live updates |
| `POST` | `/api/identity` | app | Register a player's BRC-100 identity key (for MessageBox cancel coordination) |
| `GET` | `/api/tx/:txid/hex` | `runar-overlay-express` (`mountTxHexRoute`) | Raw transaction hex lookup (engine-cached + WhatsOnChain fallback) |
| `GET` | `/stats` | app | Total game count |

### Indexing path (canonical, eventually consistent)

1. Frontend builds tx via `runar-sdk`, wallet signs, SDK posts to **both** ARC (broadcast) and overlay `/submit` (indexing).
2. Overlay engine calls the topic manager: `matchesArtifact(artifact, scriptHex)` → admit if true.
3. Engine calls `outputAdmittedByTopic` on the lookup service.
4. `GenericLookupService` runs `extractStateFromScript` + `extractConstructorArgs`, hands the result to `stateMapper`, calls `storage.upsert(record)`.
5. Frontend's REST queries see the updated state.

### Real-time SSE path (instant, signed)

1. Both players' browsers open `GET /api/games/:roomId/events` to subscribe.
2. After a successful tx, the moving player's frontend constructs a `SignedEnvelope` with `signEnvelope({ data: { roomId, game }, signer })` and POSTs to `/api/games/:roomId/broadcast`.
3. The overlay's `mountBroadcastRoute` runs `verifyEnvelope` (checks expiry, signature, nonce match, optional pubkey allowlist), then verifies the pubkey is one of `game.playerX` / `game.playerO` via the storage record, then auto-persists the new state (via the default `storage.upsert` path) and fans out to SSE subscribers.

Why both paths? The SSE path is **fast** (subsecond) and **trusted to one of the two players** (signed). The indexing path is **canonical** but lags behind ARC propagation. SSE is a UX optimization; the indexer is the source of truth.

---

## Layer 3: the frontend

A React 19 SPA built with Vite. All contract interactions happen in the browser — there is no backend server beyond the overlay.

### What `runar-react` provides

- `useWallet()` — polls BRC-100 wallet connection, caches identity key.
- `useDerivedKey(signer)` — derives the protocol-scoped public key.
- `useSubscribedRecord<T>({ id, fetchOne, sseUrl })` — fetch + SSE subscription pattern.
- `usePolledList<T>({ fetchList, intervalMs })` — interval-polled list pattern.
- `useMessageBoxPoller({ boxName, walletClient, onMessage })` — two-party off-chain coordination via `@bsv/message-box-client`.

### What `runar-sdk` provides

- `WalletProvider`, `WalletSigner` — UTXO management, EF-format broadcast via ARC, overlay submission, derived signing.
- `RunarContract` (used by the generated wrapper) — deploy + call methods.
- `signEnvelope`, `verifyEnvelope`, `canonicalJson`, `pubkeyToPKH`, `estimateFeeForArtifact` — broadcast protocol helpers.

### What this app provides

`frontend/src/`:

- **`main.tsx`, `App.tsx`** — entry point + router.
- **`lib/wallet.ts`** — `PROTOCOL_ID = [2, 'tic tac toe']`, `KEY_ID = '1'`, instantiates the `WalletSigner`.
- **`lib/wallet-provider.ts`** — instantiates `WalletProvider` (basket name, overlay URL, fee rate), exports `loadContract` helper.
- **`lib/api.ts`** — REST client for the overlay: `listGames`, `listMyGames`, `getGame`, `broadcastGameState` (signs + posts), `registerIdentityKey`.
- **`lib/types.ts`** — `Game` interface matching the overlay's `OverlayGame` schema.
- **`lib/game-logic.ts`** — pure client-side helpers: `analyzeMove()` decides whether a move is non-terminal, terminal-win, or terminal-tie by simulating against the generated contract wrapper.
- **`hooks/useGame.ts`** — thin wrapper around `useSubscribedRecord<Game>` with the overlay URLs.
- **`hooks/useGameList.ts`** — thin wrapper around `usePolledList<Game>`.
- **`hooks/useCancelFlow.ts`** — game-specific cancel choreography: uses `useMessageBoxPoller` to coordinate, calls `contract.cancelBeforeJoin` / `prepareCancel` / `finalizeCancel`.
- **`generated/TicTacToeContract.ts`** — typed wrapper generated by `runar codegen`; do not edit.
- **`pages/`** — `LandingPage` (open games + create), `MyGamesPage` (your games), `GamePage` (the board).
- **`components/`** — presentational React components.

### Contract interactions

All calls go through the generated `TicTacToeContract`:

```ts
// Create a new game
const contract = new TicTacToeContract(artifact, { playerX: pubkey, betAmount });
await contract.deployWithWallet({ satoshis: betAmount });

// Load an existing game from a UTXO
const contract = TicTacToeContract.fromUtxo(artifact, {
  txid, outputIndex, satoshis, script: lockingScript,
});
contract.connect(provider, signer);

// Join
await contract.join(null, { satoshis: betAmount * 2 });

// Non-terminal move
await contract.move(BigInt(position), null, [{ satoshis: newSatoshis, state: newState }]);

// Terminal move
await contract.moveAndWin(BigInt(position), null, changePKH, BigInt(fee), [
  { address: winner, satoshis: betAmount * 2 },
]);
```

Passing `null` for `Sig` and `PubKey` parameters tells the SDK to auto-resolve them from the connected `WalletSigner`.

---

## The signed broadcast protocol

Real-time SSE updates need to be trustable: an attacker shouldn't be able to push fake states to the opponent's browser. The pattern this app uses:

**Envelope shape** (from `runar-sdk`):

```ts
interface SignedEnvelope {
  payload: string;     // canonicalJson({ ...data, nonce, expiresAt })
  sig: string;         // DER hex of ECDSA signature
  pubkey: string;      // 66-char hex of the signer's pubkey
  nonce: number;       // Date.now() at signing
  expiresAt: number;   // typically nonce + 30_000
}
```

**Frontend (sign side)** — `frontend/src/lib/api.ts`:

```ts
const envelope = await signEnvelope({
  data: { roomId, game },
  signer,                  // the WalletSigner from lib/wallet.ts
  // ttlMs defaults to 30_000
});
await fetch(`${OVERLAY_URL}/api/games/${roomId}/broadcast`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(envelope),
});
```

**Overlay (verify side)** — `runar-overlay-express`'s `mountBroadcastRoute` runs, in order:

1. All five envelope fields present and correctly typed? → 400 if not.
2. `expiresAt >= Date.now() - 5_000` (5s clock-skew tolerance)? → 400 if expired.
3. Payload parses as JSON? → 400 if not.
4. Parsed `nonce` and `expiresAt` match the envelope's? (binds the envelope to its signed bytes) → 400 if not.
5. ECDSA verify: signature over `sha256(payload)` matches the supplied pubkey? → 401 if not.
6. App predicate: pubkey is in `getParticipants(record)` (here: `game.playerX` or `game.playerO`)? → 403 if not.
7. Auto-persist via `storage.upsert(state)` (default behavior in 0.3.x).
8. Fan out via `SSEHub.broadcast(roomId, state)`.

The result: any signed state from one of the two players reaches the opponent in subsecond, but a third party can't inject anything, and a replay of the same state inside the 30s window is harmless (same state).

This pattern is fully reusable for any Runar app — the verification is generic in `runar-overlay-express`; the per-app piece is just the `getParticipants` predicate.

---

## Identity & MessageBox cancel coordination

A two-player cancel requires both signatures to be combined into one transaction. Players coordinate off-band via [BRC-100 MessageBox](https://github.com/bitcoin-sv-wallet-stuff).

Flow:

1. On game creation/join, each player registers their BRC-100 identity key with the overlay via `POST /api/identity`. The overlay stores it next to the game (`identityKeyX` / `identityKeyO` fields).
2. Player X proposes cancel: builds a `prepareCancel` payload, signs with their key, sends to Player O's identity key via MessageBox.
3. Player O receives via `useMessageBoxPoller`, signs with their key, sends `approveCancel` back to X.
4. Player X calls `contract.finalizeCancel(prepared, sigX, sigO)` to broadcast the dual-signed terminal tx.

The MessageBox poller comes from `runar-react`; everything else is in `frontend/src/hooks/useCancelFlow.ts`.

---

## Development workflow

### Prerequisites

- **Node.js 18+** (Node 20+ recommended).
- **pnpm** (used by the sibling Runar repo) — or stick to npm at this repo's level; pnpm is only needed inside `runar/` and the two package repos when building them.
- **Docker** — for MongoDB (overlay storage) and the regtest BSV node (integration + e2e tests).
- **BRC-100 desktop wallet** at `http://localhost:3321` for frontend interaction.

### One-time setup

```bash
# 1. Clone all four sibling repos
cd ~/gitcheckout/
git clone https://github.com/icellan/runar.git
git clone https://github.com/icellan/runar-overlay-express.git
git clone https://github.com/icellan/runar-react.git
git clone https://github.com/icellan/runar-tic-tac-toe.git

# 2. Build the Runar workspace (compiler, SDK, etc.)
cd runar
pnpm install
pnpm -r build

# 3. Build the framework packages
cd ../runar-overlay-express
pnpm install
pnpm build

cd ../runar-react
pnpm install
pnpm build

# 4. Install the tic-tac-toe app (single install at root)
cd ../runar-tic-tac-toe
npm install
```

### Scripts (run from the repo root)

All scripts are namespaced. Run them from `~/gitcheckout/runar-tic-tac-toe` — no `cd` into subdirectories required.

| Script | What it does |
|---|---|
| `npm run contract:compile` | Compile `TicTacToe.runar.ts` → `contract/artifacts/TicTacToe.runar.json` |
| `npm run codegen` | Compile + regenerate `frontend/src/generated/TicTacToeContract.ts` |
| `npm run contract:test` | Run the 31 unit tests (vitest + `TestContract`, no blockchain needed) |
| `npm run contract:test:watch` | Same in watch mode |
| `npm run contract:test:integration` | Run the 19 regtest integration tests (requires regtest node) |
| `npm run contract:typecheck` | Typecheck the contract source + tests |
| `npm run contract:debug` | Launch the interactive Runar CLI debugger |
| `npm run contract:debug:move` / `:join` | Pre-loaded debugger sessions for `move()` / `join()` |
| `npm run frontend:dev` | Vite dev server on `:5173` |
| `npm run frontend:build` | Type-check + Vite production build → `frontend/dist/` |
| `npm run frontend:preview` | Preview the production build locally |
| `npm run frontend:typecheck` | Frontend tsc only |
| `npm run overlay:dev` | `tsx watch` the overlay in production mode |
| `npm run overlay:dev:regtest` | `tsx watch` in regtest mode (no chain tracker, permissive verification) |
| `npm run overlay:start` | Run the overlay once (no watcher) |
| `npm run overlay:typecheck` | Overlay tsc (covers `src/` + `test/regtest/`) |
| `npm run overlay:test:regtest` | Run the overlay e2e pipeline test (requires overlay + regtest + MongoDB up) |
| `npm run typecheck` | All three subprojects in sequence |
| `npm run test` | Alias for `contract:test` |

### Codegen

The contract source is the source of truth. After every change to `contract/TicTacToe.runar.ts`:

```bash
npm run codegen
```

This recompiles the contract, regenerates the typed wrapper, and updates `frontend/src/generated/TicTacToeContract.ts`. The frontend imports this wrapper for every contract call.

The artifact JSON at `contract/artifacts/TicTacToe.runar.json` is **gitignored** — it's a build output and is regenerated whenever needed. Both the frontend (`frontend/src/lib/wallet-provider.ts`) and the overlay (`overlay/src/artifact.ts`) read this file directly.

### Local development loop

A typical dev session:

```bash
# Terminal 1 — MongoDB + regtest node (via docker-compose from runar-overlay-express)
docker compose -f node_modules/runar-overlay-express/regtest/docker-compose.yml up

# Terminal 2 — overlay (regtest mode)
npm run overlay:dev:regtest

# Terminal 3 — frontend (with hot reload)
npm run frontend:dev
```

Then open `http://localhost:5173`, connect your BRC-100 wallet, and play.

---

## Testing

Three test layers, each runs independently:

### Unit tests (contract logic, no blockchain)

```bash
npm run contract:test
```

31 cases under `contract/TicTacToe.test.ts`. Uses `TestContract` from `runar-testing`, which interprets the contract source directly (post-`expandFixedArrays` pass). No regtest node, no Docker, fast. The same file also includes a `describe('TicTacToe debugger', ...)` block that demos the `ScriptVM` API for programmatic step-through.

### Integration tests (contract on regtest)

```bash
# Requires a regtest BSV node on localhost:18332
npm run contract:test:integration
```

19 cases under `contract/integration/tictactoe.test.ts`. Deploys the contract via `RPCProvider` + `LocalSigner` to a real regtest node, exercises every method (`join`, `move`, `moveAndWin`, `moveAndTie`, `cancelBeforeJoin`, `cancel`) end-to-end, asserts the chain accepts/rejects correctly. Doesn't touch the overlay.

The regtest scaffolding (block mining, faucet funding, RPC) is provided by `runar-overlay-express/regtest` — this project doesn't carry its own.

If no regtest node is running, the suite skips gracefully (`globalSetup` exits 0 with a clear message).

### Overlay e2e tests (overlay + regtest pipeline)

```bash
# Requires regtest BSV node + MongoDB + a running overlay process
npm run overlay:test:regtest
```

`overlay/test/regtest/pipeline.test.ts`. Exercises the full overlay pipeline: deploy contract → submit raw tx to `/submit` → topic manager admits → lookup service indexes → REST API returns the indexed state → signed broadcast envelope reaches the SSE hub → opponent receives it.

This is the most comprehensive test in the repo and the only one that exercises the overlay process end-to-end.

---

## Debugging

### Interactive CLI debugger

The Runar compiler can produce a source map; the CLI debugger uses it to single-step through the contract's Bitcoin Script execution while showing TypeScript source positions.

```bash
npm run contract:compile        # produces TicTacToe.runar.json with sourceMap
npm run contract:debug:move     # debugger for a move() call
npm run contract:debug:join     # debugger for a join() call
```

Commands inside the debugger: `step` (s), `next` (n), `continue` (c), `stack` (st), `break` (b), `info` (i), `backtrace` (bt), `quit` (q).

### Programmatic debugging in tests

The `describe('TicTacToe debugger', ...)` block in `contract/TicTacToe.test.ts` shows how to drive `ScriptVM` from a test:

```ts
import { ScriptVM, SourceMapResolver } from 'runar-testing';

const vm = new ScriptVM();
vm.loadHex(unlockingHex, lockingHex);

while (!vm.isComplete) {
  const result = vm.step();
  // Inspect result.opcode, result.mainStack, result.context.sourceLocation
}
```

Useful when you want assertions about VM state at specific opcodes, or to reproduce a failure deterministically.

### Frontend dev tools

The frontend's `lib/api.ts` and the hooks log SSE events to the browser console. The `runar-overlay-express` broadcast route returns useful 4xx status codes (400/401/403/404) — open the network tab to debug envelope verification failures.

---

## Deployment

### Frontend → static hosting

```bash
VITE_OVERLAY_URL=https://your-overlay.example.com npm run frontend:build
```

Deploy `frontend/dist/` to any static host. The `public/_redirects` file already handles Cloudflare Pages SPA routing.

### Overlay → Node service

The overlay needs:

- Node 18+
- MongoDB
- A persistent disk (overlay-express uses `knex` for some state)
- Public HTTPS endpoint matching `OVERLAY_HOSTING_URL`

A `Dockerfile` and `docker-compose.yml` are included in `overlay/` as a starting point.

Required env vars:

| Variable | Required | Where | Description |
|---|---|---|---|
| `OVERLAY_PRIVATE_KEY` | Yes | Overlay | 64-char hex private key for the overlay node's identity |
| `MONGODB_URI` | Yes | Overlay | MongoDB connection string |
| `OVERLAY_HOSTING_URL` | Yes (prod) | Overlay | Public URL the overlay is reachable at; participates in BRC-22 protocol announcements |
| `OVERLAY_PORT` | No (default `8081`) | Overlay | Listening port |
| `KNEX_URL` | Yes (prod) | Overlay | overlay-express's persistent state DB connection string |
| `MODE` | No (default `production`) | Overlay | Set to `regtest` for the dev mode (skips engine, mounts `/dev/submit`) |
| `VITE_OVERLAY_URL` | Yes (build) | Frontend | Overlay's public URL; baked into the static bundle |

### Database lifecycle

The overlay's MongoDB index is **rebuildable from chain** — it's not authoritative. If you nuke the DB, the overlay engine will eventually re-index by replaying the topic from peers (or you can manually replay archived txs through `/submit`).

This means: no backups required, no migrations to coordinate. The chain is the database.

---

## Adapting this template for your own app

Want to build a different stateful-contract app on the same stack? Here's the workflow:

1. **Replace the contract.** Write your own `*.runar.ts` extending `StatefulSmartContract`. The state shape is yours; method names are yours.
2. **Compile and codegen.** `runar compile YourContract.runar.ts -o artifacts && runar codegen artifacts/YourContract.runar.json -o ../frontend/src/generated/`. You'll get a typed client wrapper.
3. **Adapt the storage schema.** Replace `OverlayGame` in `overlay/src/TicTacToeStorage.ts` with your domain record. Implement `StorageInterface<YourRecord>` plus whatever queries your app needs (the equivalent of `findOpenGames`/`findByPlayer`).
4. **Adapt the state mapper.** In your equivalent of `TicTacToeLookupService.ts`, define `stateMapper(input) → YourRecord`. This is the only place that knows the shape of your contract's state.
5. **Replace the participant predicate.** In `overlay/src/index.ts`, replace `getParticipants: g => [g.playerX, g.playerO]` with whatever defines "who is allowed to broadcast for this record."
6. **Update query routes.** Replace the four `/api/games*` endpoints with your domain's queries.
7. **Build your UI.** The hooks (`useGame`, `useGameList`) and pages are tic-tac-toe-specific; replace them. The wallet wiring (`lib/wallet.ts`, `lib/wallet-provider.ts`) and the signed-broadcast client (`lib/api.ts`'s `broadcastGameState`) are essentially template — just change names.
8. **Keep these untouched:** the entire `runar-overlay-express` + `runar-react` + `runar-sdk` import surface. Those are the generic framework — replacing them is a different project entirely.

A successful adaptation typically results in:
- New `contract/YourContract.runar.ts` (~150-300 LOC depending on complexity)
- New storage interface + state mapper (~100-150 LOC)
- New query routes + UI (~500-2000 LOC depending on UX ambition)
- **Zero changes to package wiring or build configuration** — the structure stays.

---

## Design decisions

**Smart contract as single source of truth.** The contract enforces all rules on-chain via Bitcoin Script. The overlay indexes outcomes; it doesn't validate moves. If the contract rejects a move, the tx fails to broadcast and the indexer never sees it.

**No backend server.** The frontend is a static site. It talks directly to (a) the BRC-100 wallet for signing and (b) the overlay for queries + real-time. The overlay is the only stateful service.

**Frontend-driven contract interactions.** Building transactions, calling methods, handling fees — all in the browser via `runar-sdk`. The overlay never touches Bitcoin Script.

**Generic infrastructure in packages, app code stays thin.** Anything that would apply to a second Runar app (SSE hub, lookup service base class, signed envelope protocol, React hooks, regtest harness) lives in `runar-overlay-express`, `runar-react`, or `runar-sdk`. This repo's contribution is ~700 LOC of game-specific logic + UI.

**Signed broadcasts vs server-trusted.** The `/broadcast` endpoint requires a player-signed envelope. The overlay verifies the signature against the indexed game's `playerX` / `playerO` before fanning out. Without this, any actor could push fake state to opponents during the 30-second nonce window.

**MongoDB index is rebuildable.** The overlay's storage is a cache, not authoritative state. Lose it and re-index from chain. No migrations to manage; no backups to keep current.

**Single flat package.json.** One `node_modules`, one lockfile, one install. Scripts are namespaced (`contract:test`, `frontend:dev`, etc.) and `cd` into the relevant subdir internally. Trade-off: ~30 deps mixed in one file (browser + Node + Runar tooling). For a project this size, the simplicity wins.

**Workspace links to sibling repos.** `runar-sdk`, `runar-overlay-express`, `runar-react` are consumed via `file:../...` deps. This means anyone cloning needs the sibling repos checked out too — documented in the [setup section](#one-time-setup). Once these packages are published to npm, the `file:` references convert to semver and the sibling requirement goes away.

---

## References

- **Runar** — [github.com/icellan/runar](https://github.com/icellan/runar) (compiler, SDK, testing harness)
- **runar-overlay-express** — [github.com/icellan/runar-overlay-express](https://github.com/icellan/runar-overlay-express)
- **runar-react** — [github.com/icellan/runar-react](https://github.com/icellan/runar-react)
- **BRC-100** — Bitcoin SV wallet API standard
- **BRC-22** — Overlay Network topic announcement protocol
- **@bsv/overlay** — [github.com/bsv-blockchain/overlay-services-engine](https://github.com/bsv-blockchain/overlay-services-engine)
- **@bsv/overlay-express** — Express adapter for the overlay engine
- **@bsv/sdk** — BSV TypeScript SDK
