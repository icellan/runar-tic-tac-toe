import { StatefulSmartContract, assert, checkSig, num2bin, cat, hash160, hash256, extractOutputHash } from 'runar-lang';
import type { FixedArray, PubKey, Sig, ByteString } from 'runar-lang';

/**
 * On-chain Tic-Tac-Toe contract.
 *
 * Two players compete on a 3x3 board. Each move is an on-chain transaction.
 * The contract holds both players' bets and enforces correct game rules
 * entirely in Bitcoin Script.
 *
 * **Board encoding:**
 * The 3x3 board is a `FixedArray<bigint, 9>` which the Rúnar compiler's
 * `expand-fixed-arrays` pass desugars to 9 scalar siblings (board__0..board__8).
 * Values: 0=empty, 1=X, 2=O.
 *
 * **Lifecycle:**
 * 1. Player X deploys the contract with their bet amount.
 * 2. Player O calls {@link join} to enter the game, adding their bet.
 * 3. Players alternate calling {@link move} (non-terminal) or
 *    {@link moveAndWin} / {@link moveAndTie} (terminal).
 * 4. Either player can propose {@link cancel} (requires both signatures).
 *
 * **Method types:**
 * - State-mutating: `join`, `move` — produce a continuation UTXO.
 * - Non-mutating terminal: `moveAndWin`, `moveAndTie`, `cancel` — spend
 *   the UTXO and enforce payout outputs via extractOutputHash.
 *
 * **Signature pattern:**
 * Each method takes a `sig` and the signer's `player` pubkey. The contract
 * verifies the signature against the provided pubkey (single checkSig per
 * method, since Sig is affine/single-use), then asserts that pubkey matches
 * the expected player for the current turn.
 */
export class TicTacToe extends StatefulSmartContract {
  readonly playerX: PubKey;
  readonly betAmount: bigint;
  readonly p2pkhPrefix: ByteString = "1976a914" as ByteString;
  readonly p2pkhSuffix: ByteString = "88ac" as ByteString;

  playerO: PubKey = "000000000000000000000000000000000000000000000000000000000000000000" as PubKey;
  board: FixedArray<bigint, 9> = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
  turn: bigint = 0n;
  status: bigint = 0n;

  constructor(playerX: PubKey, betAmount: bigint) {
    super(playerX, betAmount);
    this.playerX = playerX;
    this.betAmount = betAmount;
  }

  /**
   * Player O joins the game.
   * State-mutating: produces continuation UTXO with doubled bet.
   */
  public join(opponentPK: PubKey, sig: Sig) {
    assert(this.status == 0n);
    assert(checkSig(sig, opponentPK));
    this.playerO = opponentPK;
    this.status = 1n;
    this.turn = 1n;
  }

  /**
   * Make a non-terminal move. Updates board and flips turn.
   * State-mutating: produces continuation UTXO.
   * Caller provides their pubkey; contract verifies it matches the expected turn.
   */
  public move(position: bigint, player: PubKey, sig: Sig) {
    assert(this.status == 1n);
    assert(checkSig(sig, player));
    this.assertCorrectPlayer(player);
    this.placeMove(position);
    if (this.turn == 1n) {
      this.turn = 2n;
    } else {
      this.turn = 1n;
    }
  }

  /**
   * Make a winning move. Non-mutating terminal method.
   * Enforces winner-gets-all payout via extractOutputHash.
   * Supports optional change output for fee funding.
   */
  public moveAndWin(position: bigint, player: PubKey, sig: Sig, changePKH: ByteString, changeAmount: bigint) {
    assert(this.status == 1n);
    assert(checkSig(sig, player));
    this.assertCorrectPlayer(player);
    this.assertCellEmpty(position);
    assert(this.checkWinAfterMove(position, this.turn));

    const totalPayout = this.betAmount * 2n;
    const payout = cat(cat(num2bin(totalPayout, 8n), this.p2pkhPrefix), cat(hash160(player), this.p2pkhSuffix));
    if (changeAmount > 0n) {
      const change = cat(cat(num2bin(changeAmount, 8n), this.p2pkhPrefix), cat(changePKH, this.p2pkhSuffix));
      assert(hash256(cat(payout, change)) == extractOutputHash(this.txPreimage));
    } else {
      assert(hash256(payout) == extractOutputHash(this.txPreimage));
    }
  }

  /**
   * Make a move that fills the board (tie). Non-mutating terminal method.
   * Enforces equal split payout via extractOutputHash.
   * Supports optional change output for fee funding.
   */
  public moveAndTie(position: bigint, player: PubKey, sig: Sig, changePKH: ByteString, changeAmount: bigint) {
    assert(this.status == 1n);
    assert(checkSig(sig, player));
    this.assertCorrectPlayer(player);
    this.assertCellEmpty(position);
    assert(this.countOccupied() == 8n);
    assert(!this.checkWinAfterMove(position, this.turn));

    const out1 = cat(cat(num2bin(this.betAmount, 8n), this.p2pkhPrefix), cat(hash160(this.playerX), this.p2pkhSuffix));
    const out2 = cat(cat(num2bin(this.betAmount, 8n), this.p2pkhPrefix), cat(hash160(this.playerO), this.p2pkhSuffix));
    if (changeAmount > 0n) {
      const change = cat(cat(num2bin(changeAmount, 8n), this.p2pkhPrefix), cat(changePKH, this.p2pkhSuffix));
      assert(hash256(cat(cat(out1, out2), change)) == extractOutputHash(this.txPreimage));
    } else {
      assert(hash256(cat(out1, out2)) == extractOutputHash(this.txPreimage));
    }
  }

  /**
   * Player X cancels before anyone joins. Non-mutating terminal method.
   * Refunds the full bet to player X.
   * Supports optional change output for fee funding.
   */
  public cancelBeforeJoin(sig: Sig, changePKH: ByteString, changeAmount: bigint) {
    assert(this.status == 0n);
    assert(checkSig(sig, this.playerX));
    const payout = cat(cat(num2bin(this.betAmount, 8n), this.p2pkhPrefix), cat(hash160(this.playerX), this.p2pkhSuffix));
    if (changeAmount > 0n) {
      const change = cat(cat(num2bin(changeAmount, 8n), this.p2pkhPrefix), cat(changePKH, this.p2pkhSuffix));
      assert(hash256(cat(payout, change)) == extractOutputHash(this.txPreimage));
    } else {
      assert(hash256(payout) == extractOutputHash(this.txPreimage));
    }
  }

  /**
   * Both players agree to cancel. Non-mutating terminal method.
   * Enforces equal refund via extractOutputHash.
   * Supports optional change output for fee funding.
   */
  public cancel(sigX: Sig, sigO: Sig, changePKH: ByteString, changeAmount: bigint) {
    const out1 = cat(cat(num2bin(this.betAmount, 8n), this.p2pkhPrefix), cat(hash160(this.playerX), this.p2pkhSuffix));
    const out2 = cat(cat(num2bin(this.betAmount, 8n), this.p2pkhPrefix), cat(hash160(this.playerO), this.p2pkhSuffix));
    if (changeAmount > 0n) {
      const change = cat(cat(num2bin(changeAmount, 8n), this.p2pkhPrefix), cat(changePKH, this.p2pkhSuffix));
      assert(hash256(cat(cat(out1, out2), change)) == extractOutputHash(this.txPreimage));
    } else {
      assert(hash256(cat(out1, out2)) == extractOutputHash(this.txPreimage));
    }
    assert(checkSig(sigX, this.playerX));
    assert(checkSig(sigO, this.playerO));
  }

  // --- Private helpers ---

  /** Assert the provided player pubkey matches whoever's turn it is. */
  private assertCorrectPlayer(player: PubKey) {
    if (this.turn == 1n) {
      assert(player == this.playerX);
    } else {
      assert(player == this.playerO);
    }
  }

  private assertCellEmpty(position: bigint) {
    if (position == 0n) { assert(this.board[0] == 0n); }
    else if (position == 1n) { assert(this.board[1] == 0n); }
    else if (position == 2n) { assert(this.board[2] == 0n); }
    else if (position == 3n) { assert(this.board[3] == 0n); }
    else if (position == 4n) { assert(this.board[4] == 0n); }
    else if (position == 5n) { assert(this.board[5] == 0n); }
    else if (position == 6n) { assert(this.board[6] == 0n); }
    else if (position == 7n) { assert(this.board[7] == 0n); }
    else if (position == 8n) { assert(this.board[8] == 0n); }
    else { assert(false); }
  }

  private placeMove(position: bigint) {
    this.assertCellEmpty(position);
    this.board[position as unknown as number] = this.turn;
  }

  private getCellOrOverride(cellIndex: bigint, overridePos: bigint, overrideVal: bigint): bigint {
    if (cellIndex == overridePos) {
      return overrideVal;
    }
    if (cellIndex == 0n) { return this.board[0]; }
    else if (cellIndex == 1n) { return this.board[1]; }
    else if (cellIndex == 2n) { return this.board[2]; }
    else if (cellIndex == 3n) { return this.board[3]; }
    else if (cellIndex == 4n) { return this.board[4]; }
    else if (cellIndex == 5n) { return this.board[5]; }
    else if (cellIndex == 6n) { return this.board[6]; }
    else if (cellIndex == 7n) { return this.board[7]; }
    else { return this.board[8]; }
  }

  private checkWinAfterMove(position: bigint, player: bigint): boolean {
    const v0 = this.getCellOrOverride(0n, position, player);
    const v1 = this.getCellOrOverride(1n, position, player);
    const v2 = this.getCellOrOverride(2n, position, player);
    const v3 = this.getCellOrOverride(3n, position, player);
    const v4 = this.getCellOrOverride(4n, position, player);
    const v5 = this.getCellOrOverride(5n, position, player);
    const v6 = this.getCellOrOverride(6n, position, player);
    const v7 = this.getCellOrOverride(7n, position, player);
    const v8 = this.getCellOrOverride(8n, position, player);

    if (v0 == player && v1 == player && v2 == player) { return true; }
    if (v3 == player && v4 == player && v5 == player) { return true; }
    if (v6 == player && v7 == player && v8 == player) { return true; }
    if (v0 == player && v3 == player && v6 == player) { return true; }
    if (v1 == player && v4 == player && v7 == player) { return true; }
    if (v2 == player && v5 == player && v8 == player) { return true; }
    if (v0 == player && v4 == player && v8 == player) { return true; }
    if (v2 == player && v4 == player && v6 == player) { return true; }
    return false;
  }

  private countOccupied(): bigint {
    let count = 0n;
    if (this.board[0] != 0n) { count = count + 1n; }
    if (this.board[1] != 0n) { count = count + 1n; }
    if (this.board[2] != 0n) { count = count + 1n; }
    if (this.board[3] != 0n) { count = count + 1n; }
    if (this.board[4] != 0n) { count = count + 1n; }
    if (this.board[5] != 0n) { count = count + 1n; }
    if (this.board[6] != 0n) { count = count + 1n; }
    if (this.board[7] != 0n) { count = count + 1n; }
    if (this.board[8] != 0n) { count = count + 1n; }
    return count;
  }
}
