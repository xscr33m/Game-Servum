/**
 * Game Servum — Dashboard Electron Main Process
 *
 * Standalone Dashboard SPA with credential storage, tray, and auto-updater.
 * The Agent runs as a native Windows Service — no agent code here.
 *
 * Runtime layout (packaged):
 *   resources/runtime/client/         — Vite build output (loaded by BrowserWindow)
 *
 * Writable data:
 *   Windows:  Documents/Game Servum/
 *   Linux:    ~/.config/game-servum-dashboard/
 *   macOS:    ~/Library/Application Support/Game Servum/
 */

// ─── App Imports ────────────────────────────────────────────────
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  shell,
  ipcMain,
} = require("electron");
const path = require("path");
const fs = require("fs");

const MODE = "dashboard";

app.name = "game-servum-dashboard";
app.setPath(
  "userData",
  path.join(app.getPath("appData"), "game-servum-dashboard"),
);

// ─── Single Instance Lock ──────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ─── Constants & Paths ─────────────────────────────────────────

const isDev = !app.isPackaged;

const DASHBOARD_ICON = isDev
  ? path.join(__dirname, "..", "..", "client", "public", "dashboard-icon.png")
  : path.join(__dirname, "..", "assets", "dashboard-icon.png");

// App home: writable data directory
// Platform-specific paths:
//   Windows: Documents/Game Servum
//   Linux:   ~/.config/game-servum-dashboard
//   macOS:   ~/Library/Application Support/Game Servum
const APP_HOME = isDev
  ? path.resolve(__dirname, "..", "..")
  : process.platform === "win32"
    ? path.join(app.getPath("documents"), "Game Servum")
    : process.platform === "darwin"
      ? path.join(
          app.getPath("home"),
          "Library",
          "Application Support",
          "Game Servum",
        )
      : path.join(app.getPath("home"), ".config", "game-servum-dashboard");

// ─── Logger Initialization ─────────────────────────────────────

const { SimpleLogger, DEFAULT_LOG_SETTINGS } = require("./logger.js");

const LOGS_DIR = path.join(APP_HOME, "Logs");
const logger = new SimpleLogger(MODE, LOGS_DIR, {
  ...DEFAULT_LOG_SETTINGS,
  writeToConsole: isDev,
});

logger.info(`[${MODE.toUpperCase()}] Game Servum starting...`, {
  mode: MODE,
  isDev,
  appHome: APP_HOME,
  logsDir: LOGS_DIR,
  nodeVersion: process.version,
  electronVersion: process.versions.electron,
});

// ─── Shared State ──────────────────────────────────────────────

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;

// ════════════════════════════════════════════════════════════════
//  DASHBOARD MODE
// ════════════════════════════════════════════════════════════════

function ensureDirectories() {
  if (!fs.existsSync(APP_HOME)) {
    fs.mkdirSync(APP_HOME, { recursive: true });
  }
  for (const dir of ["data", "Logs"]) {
    const p = path.join(APP_HOME, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
}

// Store dashboard connections in Documents/Game Servum/data/ so they survive reinstalls.
// (The NSIS uninstaller deletes %APPDATA% userData but preserves Documents.)
const CREDENTIALS_DIR = path.join(APP_HOME, "data");
const CONNECTIONS_FILE = path.join(
  CREDENTIALS_DIR,
  "dashboard-connections.json",
);
const SETTINGS_FILE = path.join(CREDENTIALS_DIR, "app-settings.json");

function dashboard_setupIPC() {
  logger.info("[Dashboard] Setting up IPC handlers");
  logger.debug("[Connections] Target directory:", { dir: CREDENTIALS_DIR });
  logger.debug("[Connections] Target file:", { file: CONNECTIONS_FILE });

  // Ensure data directory exists
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
    logger.info("[Connections] Created data directory");
  }

  // Check if connections file exists
  if (fs.existsSync(CONNECTIONS_FILE)) {
    const stats = fs.statSync(CONNECTIONS_FILE);
    logger.debug("[Connections] Found existing file in Documents", {
      size: stats.size,
    });
  } else {
    logger.debug("[Connections] No connections file found in Documents yet");
  }

  // ── Migrate app-settings.json from legacy userData ──
  if (!fs.existsSync(SETTINGS_FILE)) {
    const legacySettings = [
      path.join(app.getPath("userData"), "app-settings.json"),
      path.join(
        path.dirname(app.getPath("userData")),
        "game-servum-dashboard",
        "app-settings.json",
      ),
    ];

    for (const legacyPath of legacySettings) {
      if (fs.existsSync(legacyPath)) {
        logger.info("[AppSettings] Found legacy file:", { path: legacyPath });
        try {
          fs.copyFileSync(legacyPath, SETTINGS_FILE);
          logger.info("[AppSettings] ✓ Migrated to Documents");
          fs.unlinkSync(legacyPath);
          break;
        } catch (err) {
          logger.warn("[AppSettings] Migration failed:", {
            error: err.message,
          });
        }
      }
    }
  }

  logger.info("[Connections] Initialization complete");

  // ── Dashboard Connection Storage (Simple Plaintext JSON) ──
  // Stored in Documents/Game Servum/data/dashboard-connections.json
  // No encryption, no database API - simple and reliable!

  ipcMain.handle("credentials:store", async (_event, data) => {
    try {
      logger.debug("[Connections] Storing:", {
        count: Array.isArray(data) ? data.length : "invalid",
      });
      logger.debug("[Connections] Target:", { file: CONNECTIONS_FILE });

      // Write plaintext JSON with pretty formatting
      fs.writeFileSync(
        CONNECTIONS_FILE,
        JSON.stringify(data, null, 2),
        "utf-8",
      );
      logger.info("[Connections] ✓ Saved successfully");
      return { success: true, encrypted: false };
    } catch (err) {
      logger.error("[Connections] ✗ Store error:", { error: String(err) });
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("credentials:load", async () => {
    try {
      logger.debug("[Connections] Loading from:", { file: CONNECTIONS_FILE });

      if (!fs.existsSync(CONNECTIONS_FILE)) {
        logger.debug("[Connections] File does not exist, returning null");
        return { success: true, data: null };
      }

      const raw = fs.readFileSync(CONNECTIONS_FILE, "utf-8");
      const data = JSON.parse(raw);

      logger.debug("[Connections] ✓ Loaded:", {
        count: Array.isArray(data) ? data.length : "invalid",
      });
      return { success: true, data };
    } catch (err) {
      logger.error("[Connections] ✗ Load error:", { error: String(err) });
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("credentials:clear", async () => {
    try {
      if (fs.existsSync(CONNECTIONS_FILE)) {
        fs.unlinkSync(CONNECTIONS_FILE);
        logger.info("[Connections] ✓ Cleared");
      }
      return { success: true };
    } catch (err) {
      logger.error("[Connections] Clear error:", { error: String(err) });
      return { success: false, error: String(err) };
    }
  });

  // ── App Settings Storage (persists UI preferences across reinstalls) ──
  // (SETTINGS_FILE is declared at module level above)

  // Migrate legacy localStorage settings on first launch after upgrade
  const legacySettings = path.join(
    app.getPath("userData"),
    "legacy-migrated.flag",
  );
  if (!fs.existsSync(legacySettings)) {
    logger.info(
      "[AppSettings] First launch after upgrade - migration handled by renderer",
    );
    fs.writeFileSync(legacySettings, "1");
  }

  ipcMain.handle("settings:load", async () => {
    try {
      if (!fs.existsSync(SETTINGS_FILE)) {
        return { success: true, data: {} };
      }
      const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
      return { success: true, data: JSON.parse(raw) };
    } catch (err) {
      logger.error("[AppSettings] Load error:", { error: String(err) });
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("settings:save", async (_event, data) => {
    try {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf-8");
      return { success: true };
    } catch (err) {
      logger.error("[AppSettings] Save error:", { error: String(err) });
      return { success: false, error: String(err) };
    }
  });

  // ── App Info ──

  ipcMain.handle("app:getVersion", () => app.getVersion());
  ipcMain.handle("app:getPlatform", () => process.platform);
  ipcMain.handle("app:isPackaged", () => app.isPackaged);

  // ── Desktop Settings IPC ──

  ipcMain.handle("app:setLaunchOnStartup", async (_event, enabled) => {
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: false,
        args: ["--mode=dashboard"], // Launch Dashboard by default on startup
      });
      logger.info(`[AppSettings] Launch on startup: ${enabled}`);
      return { success: true };
    } catch (err) {
      logger.error("[AppSettings] Failed to set login item:", {
        error: String(err),
      });
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("app:getLaunchOnStartup", () => {
    try {
      const settings = app.getLoginItemSettings();
      return { success: true, enabled: settings.openAtLogin };
    } catch (err) {
      logger.error("[AppSettings] Failed to get login item:", {
        error: String(err),
      });
      return { success: false, enabled: false };
    }
  });

  // ── Logger IPC ──

  ipcMain.handle("logger:debug", (_event, message, data) => {
    logger.debug(message, data);
  });

  ipcMain.handle("logger:info", (_event, message, data) => {
    logger.info(message, data);
  });

  ipcMain.handle("logger:warn", (_event, message, data) => {
    logger.warn(message, data);
  });

  ipcMain.handle("logger:error", (_event, message, data) => {
    logger.error(message, data);
  });

  // ── Local Logs IPC (Dashboard mode) ──

  ipcMain.handle("logs:listFiles", async () => {
    try {
      const files = fs
        .readdirSync(LOGS_DIR)
        .filter((file) => file.endsWith(".log"))
        .map((file) => {
          const filePath = path.join(LOGS_DIR, file);
          const stats = fs.statSync(filePath);
          return {
            name: file,
            size: stats.size,
            modified: stats.mtime.toISOString(),
          };
        })
        .sort(
          (a, b) =>
            new Date(b.modified).getTime() - new Date(a.modified).getTime(),
        );
      return { success: true, files };
    } catch (err) {
      logger.error("[LogsIPC] Failed to list files:", { error: err.message });
      return { success: false, files: [], error: err.message };
    }
  });

  ipcMain.handle("logs:getFileContent", async (_event, filename, options) => {
    try {
      // Security: prevent path traversal
      if (filename.includes("..") || filename.includes("/")) {
        return { success: false, content: "", error: "Invalid filename" };
      }

      const filePath = path.join(LOGS_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return { success: false, content: "", error: "File not found" };
      }

      let content = fs.readFileSync(filePath, "utf-8");

      // If lines option specified, return only last N lines
      if (options?.lines) {
        const lines = content.split("\n");
        const startIndex = Math.max(0, lines.length - options.lines);
        content = lines.slice(startIndex).join("\n");
      }

      return { success: true, filename, content };
    } catch (err) {
      logger.error("[LogsIPC] Failed to read file:", { error: err.message });
      return { success: false, content: "", error: err.message };
    }
  });

  ipcMain.handle("logs:getSettings", async () => {
    // Return logger settings
    return {
      success: true,
      settings: logger.getSettings(),
    };
  });

  ipcMain.handle("logs:updateSettings", async (_event, updates) => {
    try {
      logger.updateSettings(updates);
      return {
        success: true,
        message: "Settings updated",
        settings: logger.getSettings(),
      };
    } catch (err) {
      logger.error("[LogsIPC] Failed to update settings:", {
        error: err.message,
      });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("logs:deleteFile", async (_event, filename) => {
    try {
      // Security: prevent path traversal
      if (filename.includes("..") || filename.includes("/")) {
        return { success: false, error: "Invalid filename" };
      }

      const filePath = path.join(LOGS_DIR, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return { success: true, message: "File deleted" };
    } catch (err) {
      logger.error("[LogsIPC] Failed to delete file:", { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("logs:cleanup", async (_event, retentionDays) => {
    try {
      if (retentionDays <= 0) {
        return {
          success: true,
          deletedCount: 0,
          message: "Retention disabled",
        };
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const files = fs.readdirSync(LOGS_DIR).filter((f) => f.endsWith(".log"));
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(LOGS_DIR, file);
        const stats = fs.statSync(filePath);
        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }

      return {
        success: true,
        deletedCount,
        message: `Deleted ${deletedCount} files`,
      };
    } catch (err) {
      logger.error("[LogsIPC] Failed to cleanup:", { error: err.message });
      return { success: false, deletedCount: 0, error: err.message };
    }
  });

  // ── Auto-Updater IPC ──

  ipcMain.handle("updater:checkForUpdates", async () => {
    try {
      const { autoUpdater } = require("electron-updater");

      // Use channel-based update discovery on all platforms
      autoUpdater.channel = MODE;

      const result = await autoUpdater.checkForUpdates();
      return { success: true, updateInfo: result?.updateInfo };
    } catch (err) {
      const errMsg = err.message || "";

      // Handle expected errors gracefully (no production release, private repo, etc.)
      if (
        errMsg.includes("404") ||
        errMsg.includes("406") ||
        errMsg.includes("Unable to find latest version") ||
        errMsg.includes("authentication token") ||
        errMsg.includes("Cannot parse releases feed")
      ) {
        logger.info(
          "[AutoUpdater] Manual check: No production release available yet",
        );
        return { success: true, updateInfo: null }; // Treat as "no updates available"
      }

      logger.error("[AutoUpdater] Check failed:", { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("updater:downloadUpdate", async () => {
    try {
      const { autoUpdater } = require("electron-updater");
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      logger.error("[AutoUpdater] Download failed:", { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("updater:installUpdate", () => {
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.quitAndInstall();
      return { success: true };
    } catch (err) {
      logger.error("[AutoUpdater] Install failed:", { error: err.message });
      return { success: false, error: err.message };
    }
  });
}

function dashboard_createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Game Servum Dashboard",
    icon: DASHBOARD_ICON,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Handle external links — open in system browser instead of Electron windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    logger.debug(`[Window] Link clicked: ${url}`);

    // Open http/https links in system browser
    if (url.startsWith("http://") || url.startsWith("https://")) {
      logger.info(`[Window] Opening external link: ${url}`);
      shell.openExternal(url);
      return { action: "deny" }; // Don't open in Electron
    }

    // Allow other protocols if needed
    return { action: "allow" };
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    // Load client from extraResources
    mainWindow.loadFile(
      path.join(process.resourcesPath, "runtime", "client", "index.html"),
    );
  }

  // Handle window close behavior based on user setting
  mainWindow.on("close", (event) => {
    if (app.isQuitting) {
      return; // Allow normal close when quitting
    }

    // Check minimize-to-tray setting
    let minimizeToTray = true; // Default: minimize to tray
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
        minimizeToTray = settings.minimize_to_tray !== "false";
      }
    } catch (err) {
      logger.error("[Window] Failed to read minimize setting:", {
        error: String(err),
      });
    }

    if (minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      logger.info("[Window] Minimized to tray");
    } else {
      // User wants to quit - destroy tray and quit app
      logger.info("[Window] Closing app (minimize to tray disabled)");
      if (tray && !tray.isDestroyed()) {
        tray.destroy();
        tray = null;
      }
      app.isQuitting = true;
      // Let the close event continue, then app will quit
    }
  });
}

function dashboard_createTray() {
  const icon = nativeImage
    .createFromPath(DASHBOARD_ICON)
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("Game Servum Dashboard");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Dashboard",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "Check for Updates",
      click: () => {
        try {
          const { autoUpdater } = require("electron-updater");
          autoUpdater.checkForUpdatesAndNotify();
        } catch {}
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function dashboard_setupAutoUpdater() {
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    // Use channel-based update discovery on all platforms
    // electron-updater looks for {channel}-{platform}.yml in GitHub Release assets
    autoUpdater.channel = MODE;
    logger.info(
      `[AutoUpdater] Channel: ${MODE} (looks for ${MODE}-${process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux"}.yml)`,
    );

    autoUpdater.on("checking-for-update", () => {
      logger.info("[AutoUpdater] Checking for updates...");
    });

    autoUpdater.on("update-available", (info) => {
      logger.info(
        `[AutoUpdater] Update available: ${info.version} (current: ${app.getVersion()})`,
      );
      if (mainWindow) {
        mainWindow.webContents.send("updater:update-available", {
          version: info.version,
          releaseDate: info.releaseDate,
          releaseNotes: info.releaseNotes,
          releaseName: info.releaseName,
        });
      }
    });

    autoUpdater.on("update-not-available", () => {
      logger.info("[AutoUpdater] No updates available");
    });

    autoUpdater.on("download-progress", (progress) => {
      logger.debug(
        `[AutoUpdater] Download progress: ${progress.percent.toFixed(1)}%`,
      );
      if (mainWindow) {
        mainWindow.webContents.send("updater:download-progress", {
          percent: progress.percent,
          transferred: progress.transferred,
          total: progress.total,
        });
      }
    });

    autoUpdater.on("update-downloaded", () => {
      logger.info("[AutoUpdater] Update downloaded — ready to install");
      if (mainWindow) {
        mainWindow.webContents.send("updater:update-downloaded");
      }
    });

    autoUpdater.on("error", (err) => {
      const errMsg = err.message || "";

      // Handle expected errors gracefully (no production release, private repo, etc.)
      if (
        errMsg.includes("404") ||
        errMsg.includes("406") ||
        errMsg.includes("Unable to find latest version") ||
        errMsg.includes("authentication token") ||
        errMsg.includes("Cannot parse releases feed")
      ) {
        logger.info("[AutoUpdater] No production release available yet");
        // Don't send error to frontend — treat as "no update available"
        return;
      }

      // Handle ENOENT errors gracefully (missing app-update.yml during development)
      if (errMsg.includes("ENOENT") || errMsg.includes("no such file")) {
        logger.info(
          "[AutoUpdater] Update metadata not found (expected during development)",
        );
        // Don't send error to frontend — this is normal for our setup
        return;
      }

      logger.error("[AutoUpdater] Error:", { error: err.message });
      if (mainWindow) {
        mainWindow.webContents.send("updater:error", {
          message: err.message,
        });
      }
    });

    // Check if auto-update is enabled via settings
    const settingsPath = path.join(APP_HOME, "data", "app-settings.json");
    let autoUpdateEnabled = true; // Default: enabled
    try {
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
        autoUpdateEnabled = settings.auto_update_enabled !== "false";
      }
    } catch {}

    if (autoUpdateEnabled) {
      logger.info("[AutoUpdater] Auto-update enabled — checking every 4 hours");
      // Check for updates every 4 hours
      setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);

      // Initial check 10 seconds after startup
      setTimeout(() => autoUpdater.checkForUpdates(), 10_000);
    } else {
      logger.info("[AutoUpdater] Auto-update disabled in settings");
    }

    // Expose manual check function
    global.checkForUpdates = () => autoUpdater.checkForUpdates();
  } catch (err) {
    logger.error("[Dashboard] electron-updater not available:", {
      error: err.message,
    });
  }
}

function dashboard_start() {
  dashboard_setupIPC();
  dashboard_createWindow();
  dashboard_createTray();

  if (app.isPackaged) {
    dashboard_setupAutoUpdater();
  }
}

// ════════════════════════════════════════════════════════════════
//  APP LIFECYCLE
// ════════════════════════════════════════════════════════════════

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  ensureDirectories();
  dashboard_start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      dashboard_createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Dashboard quits if tray was destroyed (minimize-to-tray disabled)
  if (!tray || tray.isDestroyed()) {
    app.quit();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  logger.info("[Dashboard] Application shutting down...");

  // Ensure tray is destroyed
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }

  // Shutdown logger (flush remaining buffer)
  logger.shutdown();
});
