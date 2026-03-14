/**
 * Off-chain game logic using the contract source directly.
 * The contract is executed as regular TypeScript via runar-lang/runtime stubs.
 * No duplicated game logic — the contract is the single source of truth.
 */
import { TicTacToe } from '../../../contract/TicTacToe.runar.ts'

// Win lines — only needed for UI highlighting, not game logic
const WIN_LINES: [number, number, number][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

function findWinLine(board: number[], player: number): number[] | null {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] === player && board[b] === player && board[c] === player) {
      return [a, b, c]
    }
  }
  return null
}

function parseBoard(boardStr: string): number[] {
  return boardStr.split('').map(c => parseInt(c, 10))
}

function createSimulation(board: string, turn: number, playerX: string, playerO: string): TicTacToe {
  const sim = new TicTacToe(playerX as any, 1000n)
  sim.playerO = playerO as any
  sim.turn = BigInt(turn)
  sim.status = 1n
  const cells = parseBoard(board)
  sim.c0 = BigInt(cells[0])
  sim.c1 = BigInt(cells[1])
  sim.c2 = BigInt(cells[2])
  sim.c3 = BigInt(cells[3])
  sim.c4 = BigInt(cells[4])
  sim.c5 = BigInt(cells[5])
  sim.c6 = BigInt(cells[6])
  sim.c7 = BigInt(cells[7])
  sim.c8 = BigInt(cells[8])
  return sim
}

export interface MoveAnalysis {
  method: 'move' | 'moveAndWin' | 'moveAndTie'
  winnerPubkey?: string
  playerX?: string
  playerO?: string
  winLine?: number[]
}

/**
 * Analyze a move by simulating it against the actual contract logic.
 * Uses the contract's own win detection and tie detection — zero duplication.
 */
export function analyzeMove(
  board: string,
  position: number,
  turn: number,
  playerX: string,
  playerO: string,
): MoveAnalysis {
  const fakeSig = '' as any
  const player = (turn === 1 ? playerX : playerO) as any

  // Try moveAndWin
  try {
    const sim = createSimulation(board, turn, playerX, playerO)
    sim.moveAndWin(BigInt(position), player, fakeSig, '' as any, 0n)
    // Simulate the board update for win line detection
    const cells = parseBoard(board)
    cells[position] = turn
    return {
      method: 'moveAndWin',
      winnerPubkey: turn === 1 ? playerX : playerO,
      winLine: findWinLine(cells, turn)!,
    }
  } catch {}

  // Try moveAndTie
  try {
    const sim = createSimulation(board, turn, playerX, playerO)
    sim.moveAndTie(BigInt(position), player, fakeSig, '' as any, 0n)
    return {
      method: 'moveAndTie',
      playerX,
      playerO,
    }
  } catch {}

  return { method: 'move' }
}
