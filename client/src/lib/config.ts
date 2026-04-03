// ── Backend Connection Configuration ──
// Connection model and helpers for multi-agent support.

import type { BackendConnection } from "@/types";

/**
 * Returns the API base URL for a given connection.
 */
export function getApiBase(connection?: BackendConnection | null): string {
  if (connection?.url) {
    return `${connection.url}/api/v1`;
  }
  // Development fallback (if no connection specified)
  return import.meta.env.VITE_API_URL || "/api/v1";
}

/**
 * Returns the WebSocket URL for a given connection.
 */
export function getWsUrl(connection?: BackendConnection | null): string {
  if (connection?.url) {
    const url = new URL(connection.url);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const tokenParam = connection.sessionToken
      ? `?token=${connection.sessionToken}`
      : "";
    return `${protocol}//${url.host}/ws${tokenParam}`;
  }
  // Development fallback
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

// ── Connection persistence ──

import {
  getCredentialStore,
  ElectronCredentialStore,
  cleanStaleStatuses,
} from "./credentialStore";

const STORAGE_KEY = "game-servum-connections";

/**
 * Synchronous load — reads cached data for initial render.
 * In Electron: returns pre-loaded data from ElectronCredentialStore cache.
 * In browser:  reads from localStorage directly.
 */
export function loadConnections(): BackendConnection[] {
  console.log("[config] loadConnections() called");
  const store = getCredentialStore();

  // Electron store has pre-loaded cache from init() — use it directly
  if (store instanceof ElectronCredentialStore) {
    const connections = store.loadSync();
    console.log(
      "[config] Loaded from ElectronCredentialStore:",
      connections.length,
      "connections",
    );
    if (connections.length > 0) {
      console.log(
        "[config] Connection details:",
        connections.map((c) => ({
          id: c.id,
          name: c.name,
          url: c.url,
          isActive: c.isActive,
        })),
      );
    }
    return connections;
  }

  // Browser fallback: read from localStorage
  console.log("[config] Using localStorage fallback");
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      console.log("[config] No data in localStorage");
      return [];
    }
    const parsed = cleanStaleStatuses(JSON.parse(stored));
    console.log(
      "[config] Loaded from localStorage:",
      parsed.length,
      "connections",
    );
    return parsed;
  } catch (err) {
    console.error("[config] Error loading from localStorage:", err);
    return [];
  }
}

/**
 * Save connections via the credential store.
 */
export async function saveConnectionsAsync(
  connections: BackendConnection[],
): Promise<void> {
  const store = getCredentialStore();
  await store.save(connections);
}
