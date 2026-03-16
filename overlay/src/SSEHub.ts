/**
 * In-memory Server-Sent Events hub.
 * Rooms are keyed by a stable room ID (the game's creation txid).
 * Broadcasts push JSON game state to all connected clients in a room.
 */
export class SSEHub {
  private clients = new Map<string, Set<any>>()
  private lastState = new Map<string, object>()

  subscribe(roomId: string, res: any): void {
    if (!this.clients.has(roomId)) {
      this.clients.set(roomId, new Set())
    }
    this.clients.get(roomId)!.add(res)
  }

  unsubscribe(roomId: string, res: any): void {
    const room = this.clients.get(roomId)
    if (room) {
      room.delete(res)
      if (room.size === 0) {
        this.clients.delete(roomId)
        this.lastState.delete(roomId)
      }
    }
  }

  getLastState(roomId: string): object | undefined {
    return this.lastState.get(roomId)
  }

  broadcast(roomId: string, data: object): void {
    this.lastState.set(roomId, data)
    const room = this.clients.get(roomId)
    if (!room) return
    const msg = `data: ${JSON.stringify(data)}\n\n`
    for (const res of room) {
      try {
        res.write(msg)
      } catch {
        // Client disconnected, will be cleaned up
      }
    }
  }
}
