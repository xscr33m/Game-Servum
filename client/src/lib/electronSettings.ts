// ── Electron Settings Storage ──
// Provides a localStorage-compatible API that persists data in Documents/Game-Servum/data/
// instead of Electron's userData (which gets deleted on reinstall).
//
// Usage:
//   - In browser: Falls back to normal localStorage
//   - In Electron: Stores data in app-settings.json (survives reinstalls)

import { logger } from "./logger.js";

interface ElectronSettingsAPI {
  load: () => Promise<{
    success: boolean;
    data?: Record<string, string>;
    error?: string;
  }>;
  save: (
    data: Record<string, string>,
  ) => Promise<{ success: boolean; error?: string }>;
}

function getElectronSettingsAPI(): ElectronSettingsAPI | null {
  const w = window as unknown as {
    electronAPI?: { settings?: ElectronSettingsAPI };
  };
  return w.electronAPI?.settings ?? null;
}

/**
 * Persistent settings store that survives reinstalls in Electron.
 * Falls back to localStorage in browser.
 */
class ElectronSettingsStore {
  private cache: Record<string, string> = {};
  private isElectron = false;

  async init(): Promise<void> {
    const api = getElectronSettingsAPI();
    if (!api) {
      this.isElectron = false;
      logger.info("[ElectronSettings] Not in Electron, using localStorage");
      return;
    }

    this.isElectron = true;
    logger.info("[ElectronSettings] Initializing...");

    try {
      const result = await api.load();
      if (result.success && result.data) {
        this.cache = result.data;
        const keys = Object.keys(this.cache);
        logger.info(
          `[ElectronSettings] ✓ Loaded ${keys.length} settings: ${keys.join(", ")}`,
        );
      } else {
        logger.info("[ElectronSettings] No stored settings found");
      }
    } catch (err) {
      logger.warn("[ElectronSettings] ✗ Load failed:", err);
    }
  }

  /**
   * Write cache to persistent storage (Electron) or localStorage (browser).
   */
  private async flush(): Promise<void> {
    const api = getElectronSettingsAPI();
    if (!api) return;

    try {
      const result = await api.save(this.cache);
      if (result.success) {
        logger.debug(
          `[ElectronSettings] ✓ Saved ${Object.keys(this.cache).length} settings to disk`,
        );
      } else {
        logger.error("[ElectronSettings] ✗ Save failed:", result.error);
      }
    } catch (err) {
      logger.error("[ElectronSettings] Save failed:", err);
    }
  }

  getItem(key: string): string | null {
    if (!this.isElectron) {
      return localStorage.getItem(key);
    }
    return this.cache[key] ?? null;
  }

  setItem(key: string, value: string): void {
    if (!this.isElectron) {
      localStorage.setItem(key, value);
      return;
    }

    this.cache[key] = value;
    // Flush asynchronously (fire-and-forget)
    this.flush();
  }

  /**
   * Async version of setItem that waits for the flush to complete.
   * Use this for critical settings that must be persisted immediately.
   */
  async setItemAsync(key: string, value: string): Promise<void> {
    if (!this.isElectron) {
      localStorage.setItem(key, value);
      logger.debug(
        `[ElectronSettings] setItemAsync (localStorage): ${key}=${value}`,
      );
      return;
    }

    this.cache[key] = value;
    logger.debug(
      `[ElectronSettings] setItemAsync: ${key}=${value} (flushing...)`,
    );
    await this.flush();
    logger.debug(`[ElectronSettings] ✓ Flushed ${key}=${value}`);
  }

  removeItem(key: string): void {
    if (!this.isElectron) {
      localStorage.removeItem(key);
      return;
    }

    delete this.cache[key];
    this.flush();
  }
}

// ── Singleton ──

let settingsStore: ElectronSettingsStore | null = null;

/**
 * Get the settings store instance.
 * Must be initialized via initElectronSettings() before use.
 */
export function getElectronSettings(): ElectronSettingsStore {
  if (!settingsStore) {
    settingsStore = new ElectronSettingsStore();
  }
  return settingsStore;
}

/**
 * Initialize Electron settings store (must be called before React renders).
 */
export async function initElectronSettings(): Promise<void> {
  logger.info("[ElectronSettings] Starting initialization...");
  const store = getElectronSettings();
  await store.init();
  logger.info("[ElectronSettings] ✓ Initialization complete");
}
