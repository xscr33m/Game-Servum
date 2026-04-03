import type { WSMessage } from "@/types";
import { getWsUrl, type BackendConnection } from "@/lib/config";
import { logger } from "@/lib/logger";

type MessageHandler = (message: WSMessage) => void;
type ConnectionHandler = (connected: boolean) => void;

// ── WebSocket Manager ──

class WebSocketManager {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private connectionHandlers = new Set<ConnectionHandler>();
  private connected = false;
  private reconnectTimer: number | null = null;
  private currentConnection: BackendConnection | null = null;
  private destroyed = false;

  get isConnected(): boolean {
    return this.connected;
  }

  /**
   * Connect to a backend. Pass null/undefined for development fallback.
   */
  connect(connection?: BackendConnection | null): void {
    // Disconnect existing connection first
    this.disconnect();
    this.destroyed = false;
    this.currentConnection = connection || null;
    this.doConnect();
  }

  private doConnect(): void {
    if (this.destroyed) return;
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    const wsUrl = getWsUrl(this.currentConnection);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      logger.debug("WebSocket connected");
      this.notifyConnection(true);
    };

    this.ws.onclose = (event) => {
      logger.debug(
        `WebSocket disconnected: ${event.code} ${event.reason || "(no reason)"}`,
      );
      this.notifyConnection(false);
      this.ws = null;

      // Do NOT auto-reconnect here — BackendContext owns the reconnection
      // lifecycle (health polling → re-auth → token refresh → WS recreation).
      // The WS manager's blind reconnect with a stale token URL caused race
      // conditions and duplicate connection attempts.
    };

    this.ws.onerror = () => {
      this.notifyConnection(false);
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WSMessage;
        this.handlers.forEach((handler) => handler(message));
      } catch (err) {
        logger.error("Failed to parse WebSocket message:", err);
      }
    };
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
    }
    this.notifyConnection(false);
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => {
      this.connectionHandlers.delete(handler);
    };
  }

  private notifyConnection(state: boolean): void {
    this.connected = state;
    this.connectionHandlers.forEach((h) => h(state));
  }
}

// ── Default singleton instance ──
// Used as development fallback when no connection is specified.
const defaultManager = new WebSocketManager();

/**
 * Get the default WebSocket manager (for use in BackendContext).
 */
export function getDefaultWsManager(): WebSocketManager {
  return defaultManager;
}

/**
 * Create a new WebSocket manager for a specific backend connection.
 */
export function createWsManager(
  connection?: BackendConnection | null,
): WebSocketManager {
  const manager = new WebSocketManager();
  manager.connect(connection);
  return manager;
}

export { WebSocketManager };
