import type { WebSocket } from "ws";

// Store connected WebSocket clients
const clients = new Set<WebSocket>();

/**
 * Broadcast a message to all connected WebSocket clients.
 */
export function broadcast(type: string, payload: unknown): void {
  const message = JSON.stringify({ type, payload });
  clients.forEach((client) => {
    if (client.readyState === 1) {
      // WebSocket.OPEN = 1
      client.send(message);
    }
  });
}

export function addClient(ws: WebSocket): void {
  clients.add(ws);
}

export function removeClient(ws: WebSocket): void {
  clients.delete(ws);
}

export function getAllClients(): Set<WebSocket> {
  return clients;
}

export function getClientCount(): number {
  return clients.size;
}
