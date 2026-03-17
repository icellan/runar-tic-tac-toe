/**
 * Overlay pipeline tests — exercises the full flow:
 *   regtest deploy/play → overlay /submit → TopicManager → LookupService → MongoDB → REST API
 *
 * Uses the generated TicTacToeContract class (same as the frontend) so the dev
 * harness mirrors the production call patterns exactly.
 *
 * Requires:
 *   1. Regtest node running (localhost:18332)
 *   2. Overlay running in regtest mode (cd overlay && npm run dev:regtest)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { compileContract } from './helpers/compile.js';
import { TicTacToeContract } from './TicTacToeContract.js';
import type { RunarArtifact } from 'runar-ir-schema';
import { createFundedWallet, type TestWallet } from './helpers/wallet.js';
import { createProvider } from './helpers/node.js';
import type { RPCProvider } from 'runar-sdk';
import { Transaction } from '@bsv/sdk';
import {
  submitToOverlay,
  broadcastGameState,
  getGame,
  listGames,
  getTxHex,
} from './helpers/overlay.js';

const BET_AMOUNT = 5000;

/** Submit a mined transaction to the overlay for indexing via /dev/submit. */
async function submitTx(provider: RPCProvider, txid: string) {
  const rawHex = await provider.getRawTransaction(txid);
  await submitToOverlay(rawHex);
}

/** Deploy a fresh game and submit to overlay. */
async function deployGame(
  artifact: RunarArtifact,
  provider: RPCProvider,
  playerX: TestWallet,
): Promise<{ contract: TicTacToeContract; txid: string }> {
  const contract = new TicTacToeContract(artifact, {
    playerX: playerX.pubKeyHex,
    betAmount: BigInt(BET_AMOUNT),
  });
  contract.connect(provider, playerX.signer);

  const { txid } = await contract.deploy({ satoshis: BET_AMOUNT });

  await submitTx(provider, txid);

  // Broadcast game state via REST (same as frontend)
  await broadcastGameState(txid, {
    txid,
    outputIndex: 0,
    playerX: playerX.pubKeyHex,
    playerO: '',
    board: '000000000',
    turn: 1,
    status: 0,
    betAmount: BET_AMOUNT,
    satoshis: BET_AMOUNT,
    lockingScript: contract.getLockingScript(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return { contract, txid };
}

/** Join a game and submit to overlay. */
async function joinGame(
  contract: TicTacToeContract,
  provider: RPCProvider,
  deployTxid: string,
  playerX: TestWallet,
  playerO: TestWallet,
): Promise<string> {
  // Switch to player O's signer for the join call
  contract.connect(provider, playerO.signer);

  const { txid } = await contract.join(null, { satoshis: BET_AMOUNT * 2 });

  await submitTx(provider, txid);

  await broadcastGameState(deployTxid, {
    txid,
    outputIndex: 0,
    playerX: playerX.pubKeyHex,
    playerO: playerO.pubKeyHex,
    board: '000000000',
    turn: 1,
    status: 1,
    betAmount: BET_AMOUNT,
    satoshis: BET_AMOUNT * 2,
    lockingScript: contract.getLockingScript(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return txid;
}

/** Make a move, submit to overlay, broadcast state. */
async function makeMove(
  contract: TicTacToeContract,
  provider: RPCProvider,
  roomId: string,
  pos: number,
  player: TestWallet,
  board: string,
  turn: number,
  playerX: TestWallet,
  playerO: TestWallet,
): Promise<{ txid: string; newBoard: string }> {
  // Switch to the active player's signer
  contract.connect(provider, player.signer);

  const { txid } = await contract.move(BigInt(pos), null, {
    satoshis: BET_AMOUNT * 2,
  });

  await submitTx(provider, txid);

  const newBoard = board.split('');
  newBoard[pos] = String(turn);
  const boardStr = newBoard.join('');

  await broadcastGameState(roomId, {
    txid,
    outputIndex: 0,
    playerX: playerX.pubKeyHex,
    playerO: playerO.pubKeyHex,
    board: boardStr,
    turn: turn === 1 ? 2 : 1,
    status: 1,
    betAmount: BET_AMOUNT,
    satoshis: BET_AMOUNT * 2,
    lockingScript: contract.getLockingScript(),
    updatedAt: new Date().toISOString(),
  });

  return { txid, newBoard: boardStr };
}

describe('Overlay Pipeline', () => {
  let artifact: RunarArtifact;
  let provider: RPCProvider;
  let playerX: TestWallet;
  let playerO: TestWallet;

  beforeAll(async () => {
    artifact = compileContract();
    provider = createProvider();
    playerX = await createFundedWallet(provider);
    playerO = await createFundedWallet(provider);
  });

  describe('deploy + indexing', () => {
    it('should deploy a game and find it via overlay REST API', async () => {
      const { txid } = await deployGame(artifact, provider, playerX);

      const game = await getGame(txid);
      expect(game).toBeTruthy();
      expect(game.txid).toBe(txid);
      expect(game.playerX).toBe(playerX.pubKeyHex);
      expect(game.status).toBe(0);
      expect(game.board).toBe('000000000');
    });

    it('should appear in the open games list', async () => {
      const { txid } = await deployGame(artifact, provider, playerX);

      const games = await listGames();
      const found = games.find((g: any) => g.txid === txid);
      expect(found).toBeTruthy();
    });

    it('should return raw tx hex via /api/tx/:txid/hex', async () => {
      const { txid } = await deployGame(artifact, provider, playerX);

      const hex = await getTxHex(txid);
      expect(hex).toBeTruthy();
      expect(hex!.length).toBeGreaterThan(0);
    });
  });

  describe('join + indexing', () => {
    it('should update game state after join', async () => {
      const { contract, txid: deployTxid } = await deployGame(artifact, provider, playerX);
      const joinTxid = await joinGame(contract, provider, deployTxid, playerX, playerO);

      // Query by the join txid (each UTXO transition creates a new txid)
      const game = await getGame(joinTxid);
      expect(game).toBeTruthy();
      expect(game.playerO).toBe(playerO.pubKeyHex);
      expect(game.status).toBe(1);
    });
  });

  describe('full game to win', () => {
    it('should track all moves through overlay and end with a win', async () => {
      const { contract, txid: roomId } = await deployGame(artifact, provider, playerX);
      await joinGame(contract, provider, roomId, playerX, playerO);

      // Play: X(0), O(3), X(1), O(4), X wins with moveAndWin(2)
      let board = '000000000';
      let result;

      result = await makeMove(contract, provider, roomId, 0, playerX, board, 1, playerX, playerO);
      board = result.newBoard;

      result = await makeMove(contract, provider, roomId, 3, playerO, board, 2, playerX, playerO);
      board = result.newBoard;

      result = await makeMove(contract, provider, roomId, 1, playerX, board, 1, playerX, playerO);
      board = result.newBoard;

      result = await makeMove(contract, provider, roomId, 4, playerO, board, 2, playerX, playerO);
      board = result.newBoard;

      // X wins with position 2 (top row: 0,1,2)
      contract.connect(provider, playerX.signer);
      const { txid: winTxid } = await contract.moveAndWin(
        2n, null, playerX.pubKeyHash, 0n,
        [{ scriptHex: undefined, address: playerX.pubKeyHex, satoshis: BET_AMOUNT * 2 }],
      );
      expect(winTxid).toBeTruthy();

      await submitTx(provider, winTxid);

      const finalBoard = board.split('');
      finalBoard[2] = '1';
      await broadcastGameState(roomId, {
        txid: winTxid,
        outputIndex: 0,
        playerX: playerX.pubKeyHex,
        playerO: playerO.pubKeyHex,
        board: finalBoard.join(''),
        turn: 2,
        status: 2, // X wins
        betAmount: BET_AMOUNT,
        satoshis: 0,
        lockingScript: '',
        updatedAt: new Date().toISOString(),
      });

      const finalGame = await getGame(winTxid);
      expect(finalGame).toBeTruthy();
      expect(finalGame.status).toBe(2);
      expect(finalGame.board).toBe(finalBoard.join(''));
    });
  });

  describe('full game to tie', () => {
    it('should track a tie game through the overlay', async () => {
      const { contract, txid: roomId } = await deployGame(artifact, provider, playerX);
      await joinGame(contract, provider, roomId, playerX, playerO);

      // Tie sequence: X(1), O(0), X(3), O(2), X(4), O(5), X(6), O(7), X ties with moveAndTie(8)
      let board = '000000000';
      const moves = [
        { pos: 1, player: playerX, turn: 1 },
        { pos: 0, player: playerO, turn: 2 },
        { pos: 3, player: playerX, turn: 1 },
        { pos: 2, player: playerO, turn: 2 },
        { pos: 4, player: playerX, turn: 1 },
        { pos: 5, player: playerO, turn: 2 },
        { pos: 6, player: playerX, turn: 1 },
        { pos: 7, player: playerO, turn: 2 },
      ];

      for (const m of moves) {
        const result = await makeMove(contract, provider, roomId, m.pos, m.player, board, m.turn, playerX, playerO);
        board = result.newBoard;
      }

      // X ties with position 8
      contract.connect(provider, playerX.signer);
      const { txid: tieTxid } = await contract.moveAndTie(
        8n, null, '00'.repeat(20), 0n,
        [
          { address: playerX.pubKeyHex, satoshis: BET_AMOUNT },
          { address: playerO.pubKeyHex, satoshis: BET_AMOUNT },
        ],
      );
      expect(tieTxid).toBeTruthy();

      await submitTx(provider, tieTxid);

      const finalBoard = board.split('');
      finalBoard[8] = '1';
      await broadcastGameState(roomId, {
        txid: tieTxid,
        outputIndex: 0,
        playerX: playerX.pubKeyHex,
        playerO: playerO.pubKeyHex,
        board: finalBoard.join(''),
        turn: 2,
        status: 4, // tie
        betAmount: BET_AMOUNT,
        satoshis: 0,
        lockingScript: '',
        updatedAt: new Date().toISOString(),
      });

      const finalGame = await getGame(tieTxid);
      expect(finalGame).toBeTruthy();
      expect(finalGame.status).toBe(4);
    });
  });

  describe('cancel flows', () => {
    it('should cancel before join and update overlay', async () => {
      const { contract, txid: roomId } = await deployGame(artifact, provider, playerX);

      contract.connect(provider, playerX.signer);
      const { txid: cancelTxid } = await contract.cancelBeforeJoin(
        playerX.pubKeyHash, 0n,
        [{ address: playerX.pubKeyHex, satoshis: BET_AMOUNT }],
      );
      expect(cancelTxid).toBeTruthy();

      await submitTx(provider, cancelTxid);

      await broadcastGameState(roomId, {
        txid: cancelTxid,
        outputIndex: 0,
        playerX: playerX.pubKeyHex,
        playerO: '',
        board: '000000000',
        turn: 1,
        status: 5, // cancelled
        betAmount: BET_AMOUNT,
        satoshis: 0,
        lockingScript: '',
        updatedAt: new Date().toISOString(),
      });

      const game = await getGame(cancelTxid);
      expect(game).toBeTruthy();
      expect(game.status).toBe(5);
    });
  });

  describe('raw tx retrieval', () => {
    it('should return valid hex for deploy tx', async () => {
      const { txid } = await deployGame(artifact, provider, playerX);
      const hex = await getTxHex(txid);
      expect(hex).toBeTruthy();
      const tx = Transaction.fromHex(hex!);
      expect(tx.id('hex')).toBe(txid);
    });

    it('should return valid hex for a move tx', async () => {
      const { contract, txid: roomId } = await deployGame(artifact, provider, playerX);
      await joinGame(contract, provider, roomId, playerX, playerO);

      contract.connect(provider, playerX.signer);
      const { txid: moveTxid } = await contract.move(4n, null, {
        satoshis: BET_AMOUNT * 2,
      });

      const hex = await getTxHex(moveTxid);
      expect(hex).toBeTruthy();
      const tx = Transaction.fromHex(hex!);
      expect(tx.id('hex')).toBe(moveTxid);
    });
  });
});
