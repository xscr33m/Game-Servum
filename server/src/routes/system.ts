import { Router } from "express";
import os from "os";
import { getSystemMetrics } from "../services/systemMonitor.js";
import { getAppSetting, setAppSetting } from "../db/index.js";
import {
  getAutoStartEnabled,
  setAutoStart,
  getServiceState,
} from "../services/agentSettings.js";
import {
  getUpdateState,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
} from "../services/agentUpdater.js";
import { APP_VERSION } from "@game-servum/shared";
import { logger } from "../index.js";

const router = Router();

// GET /api/system/metrics — returns current system metrics
router.get("/metrics", async (_req, res) => {
  try {
    const metrics = await getSystemMetrics();
    res.json(metrics);
  } catch (err) {
    logger.error("[System] Failed to get metrics:", err);
    res.status(500).json({ error: "Failed to get system metrics" });
  }
});

// GET /api/system/settings — returns system monitoring settings
router.get("/settings", (_req, res) => {
  try {
    const monitoringEnabled = getAppSetting("system_monitoring_enabled");
    res.json({
      monitoringEnabled: monitoringEnabled === "true",
    });
  } catch (err) {
    logger.error("[System] Failed to get settings:", err);
    res.status(500).json({ error: "Failed to get settings" });
  }
});

// PUT /api/system/settings — update system monitoring settings
router.put("/settings", (req, res) => {
  try {
    const { monitoringEnabled } = req.body;
    if (typeof monitoringEnabled === "boolean") {
      setAppSetting("system_monitoring_enabled", monitoringEnabled.toString());
    }
    res.json({ success: true, message: "Settings updated" });
  } catch (err) {
    logger.error("[System] Failed to update settings:", err);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// GET /api/system/info — returns detailed agent information
router.get("/info", (_req, res) => {
  try {
    const cpus = os.cpus();
    const serviceState = getServiceState();
    res.json({
      version: APP_VERSION,
      hostname: os.hostname(),
      platform: process.platform,
      arch: os.arch(),
      nodeVersion: process.version,
      uptime: process.uptime(),
      osUptime: os.uptime(),
      cpuModel: cpus.length > 0 ? cpus[0].model : "Unknown",
      cpuCores: cpus.length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      serviceMode: serviceState !== null,
      serviceState,
    });
  } catch (err) {
    logger.error("[System] Failed to get info:", err);
    res.status(500).json({ error: "Failed to get system info" });
  }
});

// GET /api/system/agent-settings — returns agent-specific settings
router.get("/agent-settings", (_req, res) => {
  try {
    const autoStartEnabled = getAutoStartEnabled();
    res.json({
      autoStartEnabled,
    });
  } catch (err) {
    logger.error("[System] Failed to get agent settings:", err);
    res.status(500).json({
      success: false,
      message: "Failed to read agent settings",
    });
  }
});

// PUT /api/system/agent-settings — update agent-specific settings
router.put("/agent-settings", (req, res) => {
  try {
    const { autoStartEnabled } = req.body;

    if (typeof autoStartEnabled !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Invalid request: autoStartEnabled must be a boolean",
      });
    }

    setAutoStart(autoStartEnabled);

    res.json({
      success: true,
      message: autoStartEnabled ? "Auto-start enabled" : "Auto-start disabled",
    });
  } catch (err) {
    logger.error("[System] Failed to update agent settings:", err);
    const message =
      err instanceof Error ? err.message : "Failed to update agent settings";
    res.status(500).json({
      success: false,
      message,
    });
  }
});

// POST /api/system/restart — gracefully restart the agent process
router.post("/restart", async (_req, res) => {
  logger.info("[System] Agent restart requested via API");
  res.json({ success: true, message: "Agent is restarting..." });

  // Delay to allow response to be sent, then trigger graceful shutdown
  // The flag tells the shutdown handler to exit with code 75 (restart signal)
  // and to self-spawn a replacement if not managed by Electron
  setTimeout(() => {
    logger.info("[System] Initiating agent restart via graceful shutdown...");
    (process as any).__gameServumRestart = true;
    // Use emit instead of kill — process.kill('SIGTERM') on Windows terminates
    // the process immediately without triggering the registered handler
    process.emit("SIGTERM" as any);
  }, 500);
});

// POST /api/system/shutdown — gracefully shut down the agent process
router.post("/shutdown", async (_req, res) => {
  logger.info("[System] Agent shutdown requested via API");
  res.json({ success: true, message: "Agent is shutting down..." });

  // Delay to allow response to be sent, then trigger graceful shutdown
  setTimeout(() => {
    logger.info("[System] Initiating agent shutdown...");
    process.emit("SIGTERM" as any);
  }, 500);
});

// ══════════════════════════════════════════════════════════════════
//  UPDATE MANAGEMENT
// ══════════════════════════════════════════════════════════════════

// GET /api/system/updater/status — returns current update state
router.get("/updater/status", (_req, res) => {
  try {
    const updateState = getUpdateState();
    res.json(updateState);
  } catch (err) {
    logger.error("[System] Failed to get update state:", err);
    res.status(500).json({ error: "Failed to get update state" });
  }
});

// POST /api/system/updater/check — trigger manual update check
router.post("/updater/check", async (_req, res) => {
  try {
    await checkForUpdates();
    const state = getUpdateState();
    res.json({
      success: true,
      message: state.updateAvailable
        ? `Update available: v${state.latestVersion}`
        : "Agent is up to date",
      updateAvailable: state.updateAvailable,
      latestVersion: state.latestVersion,
    });
  } catch (err) {
    logger.error("[System] Failed to check for updates:", err);
    const message =
      err instanceof Error ? err.message : "Failed to check for updates";
    res.status(500).json({ success: false, message });
  }
});

// POST /api/system/updater/download — trigger update download
router.post("/updater/download", async (_req, res) => {
  try {
    await downloadUpdate();
    res.json({ success: true, message: "Update downloaded successfully" });
  } catch (err) {
    logger.error("[System] Failed to download update:", err);
    const message =
      err instanceof Error ? err.message : "Failed to download update";
    res.status(500).json({ success: false, message });
  }
});

// POST /api/system/updater/install — trigger update installation (will restart agent)
router.post("/updater/install", async (_req, res) => {
  try {
    const updateState = getUpdateState();
    if (!updateState.downloaded) {
      return res.status(400).json({
        success: false,
        message: "No update downloaded to install",
      });
    }

    logger.info("[System] Agent update installation requested via API");
    res.json({
      success: true,
      message: "Installing update and restarting agent...",
    });

    // Delay to allow response to be sent, then trigger install
    setTimeout(() => {
      installUpdate().catch((err) => {
        logger.error("[System] Update install failed:", err);
      });
    }, 500);
  } catch (err) {
    logger.error("[System] Failed to trigger update install:", err);
    const message =
      err instanceof Error ? err.message : "Failed to trigger update install";
    res.status(500).json({ success: false, message });
  }
});

export { router as systemRouter };
