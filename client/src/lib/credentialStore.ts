// ── Credential Storage Abstraction ──
// Pluggable storage backends for persisting agent credentials.
// Current: localStorage (plaintext) + Electron IPC (plaintext file in Documents/Game-Servum/data/).

import type { BackendConnection } from "./config";

// ── Storage Backend Interface ──

export interface CredentialStore {
  load(): Promise<BackendConnection[]>;
  save(connections: BackendConnection[]): Promise<void>;
  clear(): Promise<void>;
}

// ── Storage Key ──

const STORAGE_KEY = "game-servum-connections";

// Max age for persisted updating/restarting status (5 minutes).
// If the status is older than this, it's considered stale and discarded on load.
const STATUS_MAX_AGE_MS = 5 * 60 * 1000;

// ── Sanitize connections for storage ──

function stripSensitiveSessionData(
  connections: BackendConnection[],
): Partial<BackendConnection>[] {
  return connections.map((conn) => {
    const { sessionToken, tokenExpiresAt, ...rest } = conn;
    void sessionToken;
    void tokenExpiresAt;

    // Persist "updating" / "restarting" status so the Commander knows
    // to use unlimited retries after a refresh during an agent update.
    if (conn.status === "updating" || conn.status === "restarting") {
      return {
        ...rest,
        status: conn.status,
        statusUpdatedAt: conn.statusUpdatedAt,
      };
    }

    // All other statuses are transient — strip them
    const { status, statusUpdatedAt, ...clean } = rest;
    void status;
    void statusUpdatedAt;
    return clean;
  });
}

/**
 * Clean up stale persisted statuses on load.
 * If a connection was saved with "updating" / "restarting" more than
 * STATUS_MAX_AGE_MS ago, the update likely failed — discard the status.
 */
export function cleanStaleStatuses(
  connections: BackendConnection[],
): BackendConnection[] {
  const now = Date.now();
  return connections.map((conn) => {
    if (
      (conn.status === "updating" || conn.status === "restarting") &&
      conn.statusUpdatedAt &&
      now - conn.statusUpdatedAt > STATUS_MAX_AGE_MS
    ) {
      const { status, statusUpdatedAt, ...rest } = conn;
      void status;
      void statusUpdatedAt;
      return rest as BackendConnection;
    }
    return conn;
  });
}

// ── LocalStorage (Plaintext) ──

export class LocalCredentialStore implements CredentialStore {
  async load(): Promise<BackendConnection[]> {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      return cleanStaleStatuses(JSON.parse(stored));
    } catch {
      return [];
    }
  }

  async save(connections: BackendConnection[]): Promise<void> {
    const toSave = stripSensitiveSessionData(connections);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }

  async clear(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// ── Electron Credential Store (persists in Documents/Game-Servum/data/) ──
// Uses Electron IPC to store plaintext JSON file in Documents/Game-Servum/data/commander-connections.json.
// Data survives reinstalls because Documents/ is preserved.

interface ElectronCredentialsAPI {
  store: (data: unknown) => Promise<{ success: boolean; error?: string }>;
  load: () => Promise<{ success: boolean; data: unknown; error?: string }>;
  clear: () => Promise<{ success: boolean; error?: string }>;
}

function getElectronCredentials(): ElectronCredentialsAPI | null {
  const w = window as unknown as {
    electronAPI?: { credentials?: ElectronCredentialsAPI };
  };
  return w.electronAPI?.credentials ?? null;
}

export class ElectronCredentialStore implements CredentialStore {
  /** Cached connections for synchronous access (populated by init()) */
  private cache: BackendConnection[] = [];
  private initialized = false;

  /**
   * Pre-load connections from Electron IPC.
   * Call this once before React renders so loadConnections() has data immediately.
   */
  async init(): Promise<void> {
    const api = getElectronCredentials();
    if (!api) {
      console.log("[ElectronCredentialStore] Not in Electron, skipping init");
      return;
    }

    console.log("[ElectronCredentialStore] Initializing...");
    try {
      const result = await api.load();
      console.log("[ElectronCredentialStore] Load result:", result);

      if (result.success && Array.isArray(result.data)) {
        this.cache = cleanStaleStatuses(result.data as BackendConnection[]);
        console.log(
          "[ElectronCredentialStore] ✓ Loaded",
          this.cache.length,
          "connections",
        );
      } else if (result.success && result.data === null) {
        console.log("[ElectronCredentialStore] No stored connections found");
      } else {
        console.warn("[ElectronCredentialStore] Unexpected result:", result);
      }
    } catch (err) {
      console.error("[ElectronCredentialStore] Init failed:", err);
      // Fail silently — cache stays empty
    }
    this.initialized = true;
  }

  /** Synchronous access to cached connections (for useState initializers). */
  loadSync(): BackendConnection[] {
    return this.cache;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // ── CredentialStore interface ──

  async load(): Promise<BackendConnection[]> {
    const api = getElectronCredentials();
    if (!api) return this.cache;
    try {
      const result = await api.load();
      if (result.success && Array.isArray(result.data)) {
        this.cache = cleanStaleStatuses(result.data as BackendConnection[]);
      }
    } catch {
      // Return cached data
    }
    return this.cache;
  }

  async save(connections: BackendConnection[]): Promise<void> {
    const toSave = stripSensitiveSessionData(connections);
    this.cache = connections; // Update local cache immediately

    console.log(
      "[ElectronCredentialStore] Saving",
      connections.length,
      "connections",
    );

    const api = getElectronCredentials();
    if (!api) {
      console.warn("[ElectronCredentialStore] No IPC API available");
      return;
    }

    try {
      const result = await api.store(toSave);
      if (result.success) {
        console.log("[ElectronCredentialStore] ✓ Save successful (plaintext)");
      } else {
        console.error("[ElectronCredentialStore] ✗ Save failed:", result.error);
      }
    } catch (err) {
      console.error("[ElectronCredentialStore] Save error:", err);
    }
  }

  async clear(): Promise<void> {
    this.cache = [];
    const api = getElectronCredentials();
    if (!api) return;
    try {
      await api.clear();
    } catch (err) {
      console.error("[ElectronCredentialStore] Clear error:", err);
    }
  }
}

// ── Singleton ──

let storeInstance: CredentialStore | null = null;

export function getCredentialStore(): CredentialStore {
  if (!storeInstance) {
    storeInstance = new LocalCredentialStore();
  }
  return storeInstance;
}

/**
 * Override the credential store (e.g. with Electron safeStorage implementation).
 * Call this before any React rendering.
 */
export function setCredentialStore(store: CredentialStore): void {
  storeInstance = store;
}

/**
 * Initialize the Electron credential store if running in Electron.
 * Must be awaited before React renders so connections are available synchronously.
 */
export async function initElectronCredentialStore(): Promise<void> {
  const w = window as unknown as { electronAPI?: unknown };

  console.log("[CredentialStore] Init environment check:");
  console.log("  - window.electronAPI present:", !!w.electronAPI);
  console.log("  - User agent:", navigator.userAgent);

  if (!w.electronAPI) {
    console.log(
      "[CredentialStore] Not in Electron, using LocalCredentialStore",
    );
    console.log(
      "[CredentialStore] Connections will be stored in browser localStorage",
    );
    return; // Not in Electron — keep localStorage store
  }

  console.log("[CredentialStore] Initializing ElectronCredentialStore...");
  const store = new ElectronCredentialStore();
  await store.init();
  setCredentialStore(store);
  console.log("[CredentialStore] ✓ ElectronCredentialStore active");

  // Verify the store has the right type
  const verifyStore = getCredentialStore();
  console.log(
    "[CredentialStore] Active store type:",
    verifyStore.constructor.name,
  );

  // If in Electron and store is ElectronCredentialStore, verify cache
  if (verifyStore instanceof ElectronCredentialStore) {
    const cachedConnections = verifyStore.loadSync();
    console.log(
      "[CredentialStore] Cached connections ready:",
      cachedConnections.length,
    );
  }
}
