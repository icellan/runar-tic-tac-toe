/**
 * Overlay pipeline regtest e2e test.
 *
 * Requires a regtest BSV node on localhost:18332 and a running overlay
 * (start with: `./node_modules/runar-overlay-express/regtest/start.sh`
 * with OVERLAY_DIR=overlay) plus MongoDB.
 *
 * Boot the overlay separately, then run `npm run test:regtest` in overlay/.
 */

import { resolve } from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import { Transaction } from '@bsv/sdk';
import type { RPCProvider } from 'runar-sdk';
import type { RunarArtifact } from 'runar-ir-schema';
import {
  compileContract,
  createRegtestProvider,
  createFundedRegtestWallet,
  submitToOverlay,
  broadcastSignedEnvelope,
  getRecord,
  listRecords,
  getTxHex,
  type TestWallet,
} from 'runar-overlay-express/regtest';
import { TicTacToeContract } from '../../../frontend/src/generated/TicTacToeContract.js';

const OVERLAY_URL = process.env.OVERLAY_URL ?? 'http://localhost:8081';
const BET_AMOUNT = 5000;

async function submitTx(provider: RPCProvider, txid: string): Promise<void> {
  const rawHex = await provider.getRawTransaction(txid);
  await submitToOverlay(OVERLAY_URL, rawHex);
}

async function broadcast(roomId: string, game: Record<string, unknown>): Promise<void> {
  await broadcastSignedEnvelope(OVERLAY_URL, roomId, game);
}

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
  await broadcast(txid, {
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

async function joinGame(
  contract: TicTacToeContract,
  provider: RPCProvider,
  deployTxid: string,
  playerX: TestWallet,
  playerO: TestWallet,
): Promise<string> {
  contract.connect(provider, playerO.signer);
  const { txid } = await contract.join(null, { satoshis: BET_AMOUNT * 2 });
  await submitTx(provider, txid);
  await broadcast(deployTxid, {
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

interface OverlayGame {
  txid: string;
  playerX: string;
  playerO: string;
  board: string;
  status: number;
}

describe('Overlay Pipeline (regtest e2e)', () => {
  let artifact: RunarArtifact;
  let provider: RPCProvider;
  let playerX: TestWallet;
  let playerO: TestWallet;

  beforeAll(async () => {
    const contractPath = resolve(
      __dirname,
      '..',
      '..',
      '..',
      'contract',
      'TicTacToe.runar.ts',
    );
    artifact = compileContract(contractPath);
    provider = createRegtestProvider();
    playerX = await createFundedRegtestWallet(provider);
    playerO = await createFundedRegtestWallet(provider);
  });

  it('deploys and indexes via the overlay', async () => {
    const { txid } = await deployGame(artifact, provider, playerX);
    const game = await getRecord<OverlayGame>(OVERLAY_URL, txid);
    expect(game).toBeTruthy();
    expect(game!.txid).toBe(txid);
    expect(game!.playerX).toBe(playerX.pubKeyHex);
    expect(game!.status).toBe(0);
    expect(game!.board).toBe('000000000');
  });

  it('lists the deployed game as open', async () => {
    const { txid } = await deployGame(artifact, provider, playerX);
    const games = await listRecords<OverlayGame>(OVERLAY_URL);
    expect(games.find((g) => g.txid === txid)).toBeTruthy();
  });

  it('returns raw tx hex', async () => {
    const { txid } = await deployGame(artifact, provider, playerX);
    const hex = await getTxHex(OVERLAY_URL, txid);
    expect(hex).toBeTruthy();
    expect(Transaction.fromHex(hex!).id('hex')).toBe(txid);
  });

  it('updates state after join', async () => {
    const { contract, txid: deployTxid } = await deployGame(artifact, provider, playerX);
    const joinTxid = await joinGame(contract, provider, deployTxid, playerX, playerO);
    const game = await getRecord<OverlayGame>(OVERLAY_URL, joinTxid);
    expect(game).toBeTruthy();
    expect(game!.playerO).toBe(playerO.pubKeyHex);
    expect(game!.status).toBe(1);
  });

  it('runs a full game to a win', async () => {
    const { contract, txid: roomId } = await deployGame(artifact, provider, playerX);
    await joinGame(contract, provider, roomId, playerX, playerO);

    const sequence = [
      { pos: 0, player: playerX, turn: 1 },
      { pos: 3, player: playerO, turn: 2 },
      { pos: 1, player: playerX, turn: 1 },
      { pos: 4, player: playerO, turn: 2 },
    ];

    let board = '000000000';
    for (const m of sequence) {
      contract.connect(provider, m.player.signer);
      const { txid } = await contract.move(BigInt(m.pos), null, {
        satoshis: BET_AMOUNT * 2,
      });
      await submitTx(provider, txid);
      const next = board.split('');
      next[m.pos] = String(m.turn);
      board = next.join('');
      await broadcast(roomId, {
        txid,
        outputIndex: 0,
        playerX: playerX.pubKeyHex,
        playerO: playerO.pubKeyHex,
        board,
        turn: m.turn === 1 ? 2 : 1,
        status: 1,
        betAmount: BET_AMOUNT,
        satoshis: BET_AMOUNT * 2,
        lockingScript: contract.getLockingScript(),
        updatedAt: new Date().toISOString(),
      });
    }

    contract.connect(provider, playerX.signer);
    const { txid: winTxid } = await contract.moveAndWin(
      2n,
      null,
      playerX.pubKeyHash,
      0n,
      [{ address: playerX.pubKeyHex, satoshis: BET_AMOUNT * 2 }],
    );
    expect(winTxid).toBeTruthy();
    await submitTx(provider, winTxid);

    const finalBoard = board.split('');
    finalBoard[2] = '1';
    await broadcast(roomId, {
      txid: winTxid,
      outputIndex: 0,
      playerX: playerX.pubKeyHex,
      playerO: playerO.pubKeyHex,
      board: finalBoard.join(''),
      turn: 2,
      status: 2,
      betAmount: BET_AMOUNT,
      satoshis: 0,
      lockingScript: '',
      updatedAt: new Date().toISOString(),
    });

    const finalGame = await getRecord<OverlayGame>(OVERLAY_URL, winTxid);
    expect(finalGame).toBeTruthy();
    expect(finalGame!.status).toBe(2);
    expect(finalGame!.board).toBe(finalBoard.join(''));
  });

  it('cancels before join', async () => {
    const { contract, txid: roomId } = await deployGame(artifact, provider, playerX);
    contract.connect(provider, playerX.signer);
    const { txid: cancelTxid } = await contract.cancelBeforeJoin(
      playerX.pubKeyHash,
      0n,
      [{ address: playerX.pubKeyHex, satoshis: BET_AMOUNT }],
    );
    expect(cancelTxid).toBeTruthy();
    await submitTx(provider, cancelTxid);

    await broadcast(roomId, {
      txid: cancelTxid,
      outputIndex: 0,
      playerX: playerX.pubKeyHex,
      playerO: '',
      board: '000000000',
      turn: 1,
      status: 5,
      betAmount: BET_AMOUNT,
      satoshis: 0,
      lockingScript: '',
      updatedAt: new Date().toISOString(),
    });

    const game = await getRecord<OverlayGame>(OVERLAY_URL, cancelTxid);
    expect(game).toBeTruthy();
    expect(game!.status).toBe(5);
  });
});
