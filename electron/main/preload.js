const { contextBridge, ipcRenderer } = require("electron");

/**
 * Expose a safe API to the renderer process via contextBridge.
 * The renderer (React app) accesses this as `window.electronAPI`.
 */
contextBridge.exposeInMainWorld("electronAPI", {
  // ─── Credential Storage (Plaintext JSON) ──────────────────────
  credentials: {
    /** Store credentials */
    store: (data) => ipcRenderer.invoke("credentials:store", data),
    /** Load credentials */
    load: () => ipcRenderer.invoke("credentials:load"),
    /** Clear stored credentials */
    clear: () => ipcRenderer.invoke("credentials:clear"),
  },

  // ─── App Settings (UI preferences that survive reinstalls) ─
  settings: {
    /** Load app settings */
    load: () => ipcRenderer.invoke("settings:load"),
    /** Save app settings */
    save: (data) => ipcRenderer.invoke("settings:save", data),
  },

  // ─── App Info & Desktop Settings ──────────────────────────
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
    getPlatform: () => ipcRenderer.invoke("app:getPlatform"),
    isPackaged: () => ipcRenderer.invoke("app:isPackaged"),
    // Desktop settings
    setLaunchOnStartup: (enabled) =>
      ipcRenderer.invoke("app:setLaunchOnStartup", enabled),
    getLaunchOnStartup: () => ipcRenderer.invoke("app:getLaunchOnStartup"),
  },

  // ─── Auto-Updater ─────────────────────────────────────────
  updater: {
    checkForUpdates: () => ipcRenderer.invoke("updater:checkForUpdates"),
    downloadUpdate: () => ipcRenderer.invoke("updater:downloadUpdate"),
    installUpdate: () => ipcRenderer.invoke("updater:installUpdate"),
    onUpdateAvailable: (callback) => {
      ipcRenderer.on("updater:update-available", (_event, info) =>
        callback(info),
      );
      return () => ipcRenderer.removeAllListeners("updater:update-available");
    },
    onDownloadProgress: (callback) => {
      ipcRenderer.on("updater:download-progress", (_event, progress) =>
        callback(progress),
      );
      return () => ipcRenderer.removeAllListeners("updater:download-progress");
    },
    onUpdateDownloaded: (callback) => {
      ipcRenderer.on("updater:update-downloaded", () => callback());
      return () => ipcRenderer.removeAllListeners("updater:update-downloaded");
    },
    onError: (callback) => {
      ipcRenderer.on("updater:error", (_event, error) => callback(error));
      return () => ipcRenderer.removeAllListeners("updater:error");
    },
  },

  // ─── Logger ────────────────────────────────────────────────
  logger: {
    debug: (message, data) => ipcRenderer.invoke("logger:debug", message, data),
    info: (message, data) => ipcRenderer.invoke("logger:info", message, data),
    warn: (message, data) => ipcRenderer.invoke("logger:warn", message, data),
    error: (message, data) => ipcRenderer.invoke("logger:error", message, data),
  },

  // ─── Local Logs (Dashboard Mode) ──────────────────────────
  logs: {
    /** List all log files in the local logs directory */
    listFiles: () => ipcRenderer.invoke("logs:listFiles"),
    /** Get content of a specific log file */
    getFileContent: (filename, options) =>
      ipcRenderer.invoke("logs:getFileContent", filename, options),
    /** Get logger settings */
    getSettings: () => ipcRenderer.invoke("logs:getSettings"),
    /** Update logger settings */
    updateSettings: (updates) =>
      ipcRenderer.invoke("logs:updateSettings", updates),
    /** Delete a log file */
    deleteFile: (filename) => ipcRenderer.invoke("logs:deleteFile", filename),
    /** Cleanup old log files based on retention days */
    cleanup: (retentionDays) =>
      ipcRenderer.invoke("logs:cleanup", retentionDays),
  },
});
