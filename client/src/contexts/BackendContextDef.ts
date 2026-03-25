import { createContext } from "react";
import type { WSMessage } from "@/types";
import type { BackendConnection } from "@/lib/config";
import type { ApiClient } from "@/lib/api";

export interface BackendContextValue {
  // Connections
  connections: BackendConnection[];
  activeConnection: BackendConnection | null;
  addConnection: (
    url: string,
    apiKey: string,
    password: string,
    name: string,
  ) => Promise<BackendConnection>;
  removeConnection: (id: string) => void;
  setActiveConnection: (id: string) => void;
  updateConnectionStatus: (
    id: string,
    status: BackendConnection["status"],
  ) => void;
  updateConnectionDetails: (
    id: string,
    details: Partial<Pick<BackendConnection, "name">>,
  ) => void;
  reconnectConnection: (id: string) => Promise<boolean>;
  resetReconnectAttempts: (id: string) => void;

  // API & WebSocket (scoped to active connection)
  api: ApiClient;
  subscribe: (handler: (msg: WSMessage) => void) => () => void;
  isConnected: boolean;
}

export const BackendContext = createContext<BackendContextValue | null>(null);
