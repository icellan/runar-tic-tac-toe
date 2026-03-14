/**
 * TicTacToe integration test — stateful contract on regtest node.
 *
 * Tests all 6 public methods with real on-chain transactions:
 *   - join (state-mutating): Player O enters the game
 *   - move (state-mutating): Non-terminal board move
 *   - moveAndWin (terminal): Winning move with payout enforcement
 *   - moveAndTie (terminal): Tie move with split payout
 *   - cancelBeforeJoin (terminal): X cancels before O joins
 *   - cancel (terminal, dual-sig): Both players agree to cancel
 */

import { describe, it, expect } from 'vitest';
import { compileContract } from './helpers/compile.js';
import { RunarContract, buildP2PKHScript } from 'runar-sdk';
import type { RunarArtifact } from 'runar-ir-schema';
import type { Signer } from 'runar-sdk';
import { createFundedWallet } from './helpers/wallet.js';
import { createProvider } from './helpers/node.js';
import type { RPCProvider } from 'runar-sdk';

const BET_AMOUNT = 5000;

type Wallet = { signer: Signer; pubKeyHex: string; pubKeyHash: string };

/** Deploy a fresh TicTacToe contract. */
async function deployGame(
  artifact: RunarArtifact,
  provider: RPCProvider,
  funder: Wallet,
): Promise<RunarContract> {
  const contract = new RunarContract(artifact, [funder.pubKeyHex, BigInt(BET_AMOUNT)]);
  await contract.deploy(provider, funder.signer, { satoshis: BET_AMOUNT });
  return contract;
}

/** Deploy and join: returns contract in playing state. */
async function deployAndJoin(
  artifact: RunarArtifact,
  provider: RPCProvider,
  playerX: Wallet,
  playerO: Wallet,
): Promise<RunarContract> {
  const contract = await deployGame(artifact, provider, playerX);

  await contract.call(
    'join',
    [playerO.pubKeyHex, null],
    provider,
    playerO.signer,
    { satoshis: BET_AMOUNT * 2 },
  );

  return contract;
}

/** Make a non-terminal move. */
async function makeMove(
  contract: RunarContract,
  provider: RPCProvider,
  pos: number,
  player: Wallet,
): Promise<void> {
  await contract.call(
    'move',
    [BigInt(pos), player.pubKeyHex, null],
    provider,
    player.signer,
  );
}

describe('TicTacToe', () => {
  // ---- Compilation ----
  it('should compile the TicTacToe contract', () => {
    const artifact = compileContract();
    expect(artifact).toBeTruthy();
    expect(artifact.contractName).toBe('TicTacToe');
  });

  // ---- Deploy ----
  it('should deploy with playerX and betAmount', async () => {
    const artifact = compileContract();
    const provider = createProvider();
    const { signer, pubKeyHex } = await createFundedWallet(provider);

    const contract = new RunarContract(artifact, [pubKeyHex, BigInt(BET_AMOUNT)]);
    const { txid } = await contract.deploy(provider, signer, { satoshis: BET_AMOUNT });
    expect(txid).toBeTruthy();
    expect(txid.length).toBe(64);
  });

  // ---- join ----
  describe('join', () => {
    it('should allow player O to join', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      const playerX = await createFundedWallet(provider);
      const playerO = await createFundedWallet(provider);

      const contract = await deployGame(artifact, provider, playerX);

      const { txid } = await contract.call(
        'join',
        [playerO.pubKeyHex, null],
        provider,
        playerO.signer,
        { satoshis: BET_AMOUNT * 2 },
      );
      expect(txid).toBeTruthy();
      expect(txid.length).toBe(64);
    });

    it('should reject join when game is already playing', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      const playerX = await createFundedWallet(provider);
      const playerO = await createFundedWallet(provider);

      const contract = await deployAndJoin(artifact, provider, playerX, playerO);

      const anotherPlayer = await createFundedWallet(provider);
      await expect(
        contract.call(
          'join',
          [anotherPlayer.pubKeyHex, null],
          provider,
          anotherPlayer.signer,
          { satoshis: BET_AMOUNT * 2 },
        ),
      ).rejects.toThrow();
    });
  });

  // ---- move ----
  describe('move', () => {
    it('should allow X to place a mark after join', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      const playerX = await createFundedWallet(provider);
      const playerO = await createFundedWallet(provider);

      const contract = await deployAndJoin(artifact, provider, playerX, playerO);
      await makeMove(contract, provider, 4, playerX);
    });

    it('should chain X → O → X moves', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      const playerX = await createFundedWallet(provider);
      const playerO = await createFundedWallet(provider);

      const contract = await deployAndJoin(artifact, provider, playerX, playerO);

      await makeMove(contract, provider, 4, playerX); // X center
      await makeMove(contract, provider, 0, playerO); // O top-left
      await makeMove(contract, provider, 8, playerX); // X bottom-right
    });

    it('should reject move with wrong player signer', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      const playerX = await createFundedWallet(provider);
      const playerO = await createFundedWallet(provider);

      const contract = await deployAndJoin(artifact, provider, playerX, playerO);

      // It's X's turn but O tries to move
      await expect(
        contract.call(
          'move',
          [0n, playerO.pubKeyHex, null],
          provider,
          playerO.signer,
        ),
      ).rejects.toThrow();
    });

    it('should reject move on occupied cell', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      const playerX = await createFundedWallet(provider);
      const playerO = await createFundedWallet(provider);

      const contract = await deployAndJoin(artifact, provider, playerX, playerO);

      // X moves to center
      await makeMove(contract, provider, 4, playerX);

      // O tries to also move to center (occupied)
      await expect(
        contract.call(
          'move',
          [4n, playerO.pubKeyHex, null],
          provider,
          playerO.signer,
        ),
      ).rejects.toThrow();
    });
  });

  // ---- moveAndWin ----
  describe('moveAndWin', () => {
    it('should pay winner when X wins top row', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      const playerX = await createFundedWallet(provider);
      const playerO = await createFundedWallet(provider);

      const contract = await deployAndJoin(artifact, provider, playerX, playerO);

      // Play: X(0), O(3), X(1), O(4) → X wins with position 2 (top row)
      await makeMove(contract, provider, 0, playerX);
      await makeMove(contract, provider, 3, playerO);
      await makeMove(contract, provider, 1, playerX);
      await makeMove(contract, provider, 4, playerO);

      const winnerScript = buildP2PKHScript(playerX.pubKeyHex);

      const { txid } = await contract.call(
        'moveAndWin',
        [2n, playerX.pubKeyHex, null, playerX.pubKeyHash, 0n],
        provider,
        playerX.signer,
        {
          terminalOutputs: [
            { scriptHex: winnerScript, satoshis: BET_AMOUNT * 2 },
          ],
        },
      );
      expect(txid).toBeTruthy();
      expect(txid.length).toBe(64);
    });

    it('should pay winner when O wins a column', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      const playerX = await createFundedWallet(provider);
      const playerO = await createFundedWallet(provider);

      const contract = await deployAndJoin(artifact, provider, playerX, playerO);

      // X(0), O(1), X(3), O(4), X(8), O(7) → O wins column 1 (positions 1,4,7)
      await makeMove(contract, provider, 0, playerX);
      await makeMove(contract, provider, 1, playerO);
      await makeMove(contract, provider, 3, playerX);
      await makeMove(contract, provider, 4, playerO);
      await makeMove(contract, provider, 8, playerX);

      const winnerScript = buildP2PKHScript(playerO.pubKeyHex);

      const { txid } = await contract.call(
        'moveAndWin',
        [7n, playerO.pubKeyHex, null, playerO.pubKeyHash, 0n],
        provider,
        playerO.signer,
        {
          terminalOutputs: [
            { scriptHex: winnerScript, satoshis: BET_AMOUNT * 2 },
          ],
        },
      );
      expect(txid).toBeTruthy();
    });

    it('should pay winner on diagonal win', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      const playerX = await createFundedWallet(provider);
      const playerO = await createFundedWallet(provider);

      const contract = await deployAndJoin(artifact, provider, playerX, playerO);

      // X(0), O(1), X(4), O(2), X(8) → X wins diagonal (0,4,8)
      await makeMove(contract, provider, 0, playerX);
      await makeMove(contract, provider, 1, playerO);
      await makeMove(contract, provider, 4, playerX);
      await makeMove(contract, provider, 2, playerO);

      const winnerScript = buildP2PKHScript(playerX.pubKeyHex);

      const { txid } = await contract.call(
        'moveAndWin',
        [8n, playerX.pubKeyHex, null, playerX.pubKeyHash, 0n],
        provider,
        playerX.signer,
        {
          terminalOutputs: [
            { scriptHex: winnerScript, satoshis: BET_AMOUNT * 2 },
          ],
        },
      );
      expect(txid).toBeTruthy();
    });

    it('should reject moveAndWin when move does not create a win', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      const playerX = await createFundedWallet(provider);
      const playerO = await createFundedWallet(provider);

      const contract = await deployAndJoin(artifact, provider, playerX, playerO);

      // Only one X mark so far
      await makeMove(contract, provider, 0, playerX);
      // O tries to claim a non-existent win (only 1 mark)
      await expect(
        contract.call(
          'moveAndWin',
          [1n, playerO.pubKeyHex, null, playerO.pubKeyHash, 0n],
          provider,
          playerO.signer,
          {
            terminalOutputs: [
              { scriptHex: buildP2PKHScript(playerO.pubKeyHex), satoshis: BET_AMOUNT * 2 },
            ],
          },
        ),
      ).rejects.toThrow();
    });
  });

  // ---- moveAndTie ----
  describe('moveAndTie', () => {
    it('should split payout on tie', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      const playerX = await createFundedWallet(provider);
      const playerO = await createFundedWallet(provider);

      const contract = await deployAndJoin(artifact, provider, playerX, playerO);

      // Tie sequence: X(1), O(0), X(3), O(2), X(4), O(5), X(6), O(7)
      // Board after 8 moves:
      //   0:O 1:X 2:O
      //   3:X 4:X 5:O
      //   6:X 7:O 8:_
      // X plays 8 via moveAndTie → O,X,O / X,X,O / X,O,X → TIE
      // Tie sequence: X(1), O(0), X(3), O(2), X(4), O(5), X(6), O(7)
      // Board after 8 moves:
      //   0:O 1:X 2:O
      //   3:X 4:X 5:O
      //   6:X 7:O 8:_
      // X plays 8 via moveAndTie → O,X,O / X,X,O / X,O,X → TIE
      await makeMove(contract, provider, 1, playerX);
      await makeMove(contract, provider, 0, playerO);
      await makeMove(contract, provider, 3, playerX);
      await makeMove(contract, provider, 2, playerO);
      await makeMove(contract, provider, 4, playerX);
      await makeMove(contract, provider, 5, playerO);
      await makeMove(contract, provider, 6, playerX);
      await makeMove(contract, provider, 7, playerO);

      const p2pkhX = buildP2PKHScript(playerX.pubKeyHex);
      const p2pkhO = buildP2PKHScript(playerO.pubKeyHex);

      const { txid } = await contract.call(
        'moveAndTie',
        [8n, playerX.pubKeyHex, null, '00'.repeat(20), 0n],
        provider,
        playerX.signer,
        {
          terminalOutputs: [
            { scriptHex: p2pkhX, satoshis: BET_AMOUNT },
            { scriptHex: p2pkhO, satoshis: BET_AMOUNT },
          ],
        },
      );
      expect(txid).toBeTruthy();
      expect(txid.length).toBe(64);
    });

    it('should reject moveAndTie when board is not full after move', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      const playerX = await createFundedWallet(provider);
      const playerO = await createFundedWallet(provider);

      const contract = await deployAndJoin(artifact, provider, playerX, playerO);

      // Only 2 moves played, board far from full
      await makeMove(contract, provider, 0, playerX);
      await makeMove(contract, provider, 1, playerO);

      await expect(
        contract.call(
          'moveAndTie',
          [2n, playerX.pubKeyHex, null, playerX.pubKeyHash, 0n],
          provider,
          playerX.signer,
          {
            terminalOutputs: [
              { scriptHex: buildP2PKHScript(playerX.pubKeyHex), satoshis: BET_AMOUNT },
              { scriptHex: buildP2PKHScript(playerO.pubKeyHex), satoshis: BET_AMOUNT },
            ],
          },
        ),
      ).rejects.toThrow();
    });
  });

  // ---- cancelBeforeJoin ----
  describe('cancelBeforeJoin', () => {
    it('should refund X when cancelling before join', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      const playerX = await createFundedWallet(provider);

      const contract = await deployGame(artifact, provider, playerX);

      const p2pkhX = buildP2PKHScript(playerX.pubKeyHex);

      const { txid } = await contract.call(
        'cancelBeforeJoin',
        [null, playerX.pubKeyHash, 0n],
        provider,
        playerX.signer,
        {
          terminalOutputs: [
            { scriptHex: p2pkhX, satoshis: BET_AMOUNT },
          ],
        },
      );
      expect(txid).toBeTruthy();
      expect(txid.length).toBe(64);
    });

    it('should reject cancelBeforeJoin with wrong signer', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      const playerX = await createFundedWallet(provider);

      const contract = await deployGame(artifact, provider, playerX);

      const wrongPlayer = await createFundedWallet(provider);

      await expect(
        contract.call(
          'cancelBeforeJoin',
          [null, wrongPlayer.pubKeyHash, 0n],
          provider,
          wrongPlayer.signer,
          {
            terminalOutputs: [
              { scriptHex: buildP2PKHScript(playerX.pubKeyHex), satoshis: BET_AMOUNT },
            ],
          },
        ),
      ).rejects.toThrow();
    });

    it('should reject cancelBeforeJoin after game started', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      // Use same key for X and O so we can sign both roles
      const player = await createFundedWallet(provider);

      const contract = await deployGame(artifact, provider, player);

      // Join first (same signer for both roles)
      await contract.call(
        'join',
        [player.pubKeyHex, null],
        provider,
        player.signer,
        { satoshis: BET_AMOUNT * 2 },
      );

      // Now cancelBeforeJoin should fail (status != 0)
      await expect(
        contract.call(
          'cancelBeforeJoin',
          [null, player.pubKeyHash, 0n],
          provider,
          player.signer,
          {
            terminalOutputs: [
              { scriptHex: buildP2PKHScript(player.pubKeyHex), satoshis: BET_AMOUNT },
            ],
          },
        ),
      ).rejects.toThrow();
    });
  });

  // ---- cancel (dual-sig) ----
  describe('cancel', () => {
    it('should split payout when both players cancel', async () => {
      const artifact = compileContract();
      const provider = createProvider();

      // SDK limitation: single signer, so use same key for both roles
      const player = await createFundedWallet(provider);

      const contract = await deployGame(artifact, provider, player);

      // Join with same key as playerO
      await contract.call(
        'join',
        [player.pubKeyHex, null],
        provider,
        player.signer,
        { satoshis: BET_AMOUNT * 2 },
      );

      const p2pkh = buildP2PKHScript(player.pubKeyHex);

      const { txid } = await contract.call(
        'cancel',
        [null, null, player.pubKeyHash, 0n],
        provider,
        player.signer,
        {
          terminalOutputs: [
            { scriptHex: p2pkh, satoshis: BET_AMOUNT },
            { scriptHex: p2pkh, satoshis: BET_AMOUNT },
          ],
        },
      );
      expect(txid).toBeTruthy();
      expect(txid.length).toBe(64);
    });
  });

  // ---- Full game flow ----
  describe('full game', () => {
    it('should play a complete game from deploy to win', async () => {
      const artifact = compileContract();
      const provider = createProvider();
      const playerX = await createFundedWallet(provider);
      const playerO = await createFundedWallet(provider);

      const contract = await deployAndJoin(artifact, provider, playerX, playerO);

      // X(4), O(0), X(2), O(1), X(6) → X wins antidiag (2,4,6)
      await makeMove(contract, provider, 4, playerX); // X center
      await makeMove(contract, provider, 0, playerO); // O top-left
      await makeMove(contract, provider, 2, playerX); // X top-right
      await makeMove(contract, provider, 1, playerO); // O top-mid

      // X wins with position 6 (anti-diagonal: 2,4,6)
      const winnerScript = buildP2PKHScript(playerX.pubKeyHex);

      const { txid } = await contract.call(
        'moveAndWin',
        [6n, playerX.pubKeyHex, null, playerX.pubKeyHash, 0n],
        provider,
        playerX.signer,
        {
          terminalOutputs: [
            { scriptHex: winnerScript, satoshis: BET_AMOUNT * 2 },
          ],
        },
      );
      expect(txid).toBeTruthy();
      expect(txid.length).toBe(64);
    });
  });
});
