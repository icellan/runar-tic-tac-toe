export interface Game {
  gameId: string
  currentTxid: string
  currentVout: number
  playerX: string
  playerO: string
  board: string
  turn: number
  status: number // 0=waiting, 1=playing, 2=x_wins, 3=o_wins, 4=tie, 5=cancelled
  betAmount: number
  identityKeyX?: string
  identityKeyO?: string
  createdAt: string
  updatedAt: string
}

export interface BroadcastResponse {
  txid: string
  gameId?: string
  game: Game
}

export interface WalletState {
  connected: boolean
  pubkey: string
  balance: number
}

export const STATUS_LABELS: Record<number, string> = {
  0: 'Waiting for opponent',
  1: 'In progress',
  2: 'X wins',
  3: 'O wins',
  4: 'Tie',
  5: 'Cancelled',
}
