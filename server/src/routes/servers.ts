import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import path from "path";
import os from "os";
import fs from "fs";
import fsPromises from "fs/promises";
import { exec } from "child_process";
import multer from "multer";
import AdmZip from "adm-zip";
import { logger } from "../core/logger.js";
import { broadcast } from "../core/broadcast.js";
import {
  getAllServers,
  getServerById,
  createServer,
  updateServerStatus,
  updateServerLaunchParams,
  updateServerProfilesPath,
  updateServerPorts,
  updateServerName,
  updateServerAutoRestart,
  getModsByServerId,
  createMod,
  updateModEnabled,
  updateModLoadOrder,
  getOnlinePlayers,
  getPlayerSummaries,
  getLogSettings as getLogSettingsFromDb,
  updateLogSettings as updateLogSettingsInDb,
  getScheduleByServerId,
  upsertSchedule,
  deleteSchedule as deleteScheduleFromDb,
  getMessagesByServerId,
  createMessage,
  getMessageById,
  updateMessage,
  deleteMessage as deleteMessageFromDb,
  getVariablesByServerId,
  upsertVariable,
  deleteVariable as deleteVariableFromDb,
  getUpdateRestartSettings,
  upsertUpdateRestartSettings,
} from "../db/index.js";
import { getConfig } from "../services/config.js";
import {
  getSteamConfig,
  getUsedPorts,
  getBackupsByServerId,
  getBackupSettings as getBackupSettingsFromDb,
  upsertBackupSettings,
  updateBackupRecord,
} from "../db/index.js";
import {
  getAllGameDefinitions,
  getGameDefinition,
  getGameAdapter,
  getAllPortsFromRules,
  getQueryPortOffset,
  getConsecutivePortCount,
} from "../games/index.js";
import { STEAM_RESERVED_PORT_RANGES } from "@game-servum/shared";
import { readGameFile } from "../games/encoding.js";
import {
  cancelAndCleanupInstallation,
  isInstalling,
  getInstallationProgress,
  queueInstallation,
} from "../services/serverInstall.js";
import {
  startServer,
  stopServer,
  isServerRunning,
  checkServerRequirements,
  isFirstStartInProgress,
} from "../services/serverProcess.js";
import { startSchedule, clearSchedule } from "../services/scheduler.js";
import { reloadMessageBroadcaster } from "../services/messageBroadcaster.js";
import { getRconConnection } from "../services/playerTracker.js";
import { BUILTIN_VARIABLES } from "../services/variableResolver.js";
import {
  triggerUpdateCheck,
  startUpdateChecker,
  hasPendingUpdateRestart,
} from "../services/updateChecker.js";
import { performBackgroundDeletion } from "../services/serverDelete.js";
import {
  createBackup,
  restoreBackup,
  deleteBackup,
  isBackupRunning,
  backupFileExists,
  getBackupFilePath,
  getBackupStoragePath,
} from "../services/backupManager.js";
import {
  parseWorkshopId,
  getWorkshopModInfo,
  installMod,
  uninstallMod,
  generateModParams,
  cancelModInstallation,
} from "../services/modManager.js";
import {
  getCurrentLogs,
  getArchivedSessions,
  getArchivedSessionFiles,
  readLogContent,
  deleteArchivedSession,
} from "../services/logManager.js";
import {
  checkFirewallRules,
  addFirewallRules,
  removeFirewallRules,
  updateFirewallRules,
} from "../services/firewallManager.js";
import type { CreateServerRequest, GameServer } from "../types/index.js";

const router = Router();

/**
 * Sanitize a string for use as a Windows directory name.
 * Replaces characters illegal in Windows filenames: < > : " | ? *
 */
function sanitizeDirName(name: string): string {
  return name
    .replace(/[<>:"|?*]/g, "") // Remove illegal characters
    .replace(/_+/g, "_") // Replace multiple underscores with a single one
    .trim(); // Trim leading/trailing whitespace
}

// GET /api/servers/games - List all available game definitions
router.get("/games", (_req: Request, res: Response) => {
  const games = getAllGameDefinitions().map((game) => ({
    id: game.id,
    name: game.name,
    logo: game.logo,
    appId: game.appId,
    workshopAppId: game.workshopAppId,
    defaultPort: game.defaultPort,
    portCount: getConsecutivePortCount(game),
    portStride: game.portStride,
    queryPortOffset: getQueryPortOffset(game),
    requiresLogin: game.requiresLogin,
    description: game.description,
    defaultLaunchParams: game.defaultLaunchParams,
    firewallRules: game.firewallRules ?? [],
    capabilities: game.capabilities,
  }));
  res.json(games);
});

// GET /api/servers - List all servers
router.get("/", (_req: Request, res: Response) => {
  const servers = getAllServers();
  res.json(servers);
});

// GET /api/servers/used-ports - Get all ports used by existing servers
router.get("/used-ports", (_req: Request, res: Response) => {
  const usedPorts = getUsedPorts();
  res.json(usedPorts);
});

// GET /api/servers/suggest-ports - Suggest next available ports for a game
router.get("/suggest-ports", (req: Request, res: Response) => {
  const gameId = req.query.gameId as string;
  if (!gameId) {
    return res
      .status(400)
      .json({ error: "gameId query parameter is required" });
  }

  const gameDef = getGameDefinition(gameId);
  if (!gameDef) {
    return res.status(400).json({ error: `Unknown game: ${gameId}` });
  }

  // Collect ALL ports in use across all servers (using firewallRules as source of truth)
  const servers = getUsedPorts();
  const allUsedPorts = new Set<number>();
  for (const s of servers) {
    for (const p of getAllPortsFromRules(s.port, s.gameId)) {
      allUsedPorts.add(p);
    }
  }

  // Find next available base port (stride for clean aligned ranges)
  let candidate = gameDef.defaultPort;
  const maxPort = 65535;

  while (candidate < maxPort) {
    const portsNeeded = getAllPortsFromRules(candidate, gameId);

    // Check: all ports available, within range, and not in Steam reserved ranges
    const isAvailable = portsNeeded.every(
      (p) =>
        !allUsedPorts.has(p) &&
        p <= maxPort &&
        !STEAM_RESERVED_PORT_RANGES.some(([lo, hi]) => p >= lo && p <= hi),
    );

    if (isAvailable) {
      // Build port details from firewallRules for richer frontend display
      const portDetails = (gameDef.firewallRules ?? []).map((rule) => {
        const start = candidate + rule.portOffset;
        const end = start + rule.portCount - 1;
        return {
          startPort: start,
          endPort: end,
          protocol: rule.protocol,
          description: rule.description,
        };
      });

      const qpOffset = getQueryPortOffset(gameDef);
      return res.json({
        port: candidate,
        queryPort: qpOffset != null ? candidate + qpOffset : null,
        portsUsed: portsNeeded,
        portDetails,
      });
    }

    candidate += gameDef.portStride || getConsecutivePortCount(gameDef);
  }

  // Fallback: return defaults
  const fallbackQpOffset = getQueryPortOffset(gameDef);
  res.json({
    port: gameDef.defaultPort,
    queryPort:
      fallbackQpOffset != null ? gameDef.defaultPort + fallbackQpOffset : null,
    portsUsed: [gameDef.defaultPort],
    portDetails: [],
  });
});

// POST /api/servers - Create and install a new server
router.post("/", async (req: Request, res: Response) => {
  const body = req.body as CreateServerRequest;
  const config = getConfig();

  if (!body.name || !body.gameId) {
    return res.status(400).json({ error: "Name and gameId are required" });
  }

  // Get game definition
  const gameDef = getGameDefinition(body.gameId);
  if (!gameDef) {
    return res.status(400).json({ error: `Unknown game: ${body.gameId}` });
  }

  // Check if login is required
  const steamConfig = getSteamConfig();
  if (gameDef.requiresLogin && !steamConfig?.isLoggedIn) {
    return res.status(400).json({
      error: `${gameDef.name} requires Steam login. Please login first.`,
    });
  }

  // Default install path (sanitize name for Windows filesystem compatibility)
  const installPath =
    body.installPath ||
    path.join(config.serversPath, sanitizeDirName(body.name));

  // Check for port conflicts with existing servers (using firewallRules as source of truth)
  const requestedPort = body.port || gameDef.defaultPort;
  const createQpOffset = getQueryPortOffset(gameDef);
  const _requestedQueryPort =
    body.queryPort ||
    (createQpOffset != null ? requestedPort + createQpOffset : null);

  // Collect ALL ports in use across all servers
  const servers = getUsedPorts();
  const allUsedPorts = new Set<number>();
  for (const s of servers) {
    for (const p of getAllPortsFromRules(s.port, s.gameId)) {
      allUsedPorts.add(p);
    }
  }

  // Get all ports the new server would occupy
  const requestedPorts = getAllPortsFromRules(requestedPort, body.gameId);

  // Check for conflicts with existing servers and Steam reserved ranges
  const conflicts: string[] = [];
  for (const p of requestedPorts) {
    if (allUsedPorts.has(p)) {
      const conflictServer = servers.find((s) => {
        const sPorts = getAllPortsFromRules(s.port, s.gameId);
        return sPorts.includes(p);
      });
      conflicts.push(
        `Port ${p} is already used by "${conflictServer?.name || "unknown"}"`,
      );
    }
    if (STEAM_RESERVED_PORT_RANGES.some(([lo, hi]) => p >= lo && p <= hi)) {
      conflicts.push(`Port ${p} is in the Steam reserved range (27030-27050)`);
    }
  }

  if (conflicts.length > 0) {
    return res.status(400).json({
      error: `Port conflict: ${conflicts.join(". ")}`,
    });
  }

  // Create server entry in database
  const serverId = createServer({
    gameId: body.gameId,
    name: body.name,
    appId: gameDef.appId,
    installPath,
    executable: gameDef.executable,
    launchParams: body.launchParams || gameDef.defaultLaunchParams,
    port: body.port || gameDef.defaultPort,
    queryPort:
      body.queryPort ||
      (createQpOffset != null
        ? (body.port || gameDef.defaultPort) + createQpOffset
        : null),
    profilesPath: "profiles",
  });

  const server = getServerById(serverId);

  // Start installation (queued if another install is in progress)
  queueInstallation({
    serverId,
    gameId: body.gameId,
    appId: gameDef.appId,
    installPath,
    serverName: body.name,
    port: body.port || gameDef.defaultPort,
    useAnonymous: !gameDef.requiresLogin,
    username: steamConfig?.username,
    password: null, // Password is managed by SteamCMD session
  });

  // Add firewall rules in background (non-blocking)
  addFirewallRules({
    name: body.name,
    port: body.port || gameDef.defaultPort,
    installPath,
    executable: gameDef.executable,
    gameId: body.gameId,
  })
    .then((result) => {
      if (result.errors.length > 0) {
        logger.error(
          `[Firewall] Errors creating rules for ${body.name}:`,
          result.errors,
        );
      }
      broadcast("firewall:updated", { serverId, ...result });
    })
    .catch((err) => {
      logger.error("[Firewall] Failed to create rules:", err);
    });

  res.status(201).json({
    server,
    message: "Server created, installation started",
  });
});

// GET /api/servers/:id - Get server details
router.get("/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  // Add installation status
  const installing = isInstalling(id);

  res.json({
    ...server,
    installing,
    hasPendingUpdateRestart: hasPendingUpdateRestart(id),
  });
});

// GET /api/servers/:id/check - Check server requirements before starting
router.get("/:id/check", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const checkResult = checkServerRequirements(id);
  res.json(checkResult);
});

// POST /api/servers/:id/start - Start server
router.post("/:id/start", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (server.status === "running" || isServerRunning(id)) {
    return res.status(400).json({ error: "Server is already running" });
  }

  if (server.status === "starting") {
    return res.status(400).json({ error: "Server is already starting" });
  }

  if (server.status === "stopping") {
    return res.status(400).json({ error: "Server is currently stopping" });
  }

  if (server.status === "installing") {
    return res.status(400).json({ error: "Server is still installing" });
  }

  if (server.status === "queued") {
    return res.status(400).json({ error: "Server is queued for installation" });
  }

  if (server.status === "deleting") {
    return res.status(400).json({ error: "Server is being deleted" });
  }

  // Pre-start backup if enabled
  const backupSettings = getBackupSettingsFromDb(id);
  if (backupSettings?.backupBeforeStart) {
    logger.info(`[Backup] Creating pre-start backup for server ${id}`);
    const backupResult = await createBackup(id, {
      trigger: "pre-start",
      skipServerLifecycle: true,
    });
    if (!backupResult.success) {
      logger.warn(
        `[Backup] Pre-start backup failed for server ${id}: ${backupResult.message}`,
      );
    }
  }

  const result = startServer(id);

  if (result.success) {
    res.json({ success: true, message: result.message, pid: result.pid });
  } else {
    res.status(400).json({ error: result.message });
  }
});

// POST /api/servers/:id/stop - Stop server
router.post("/:id/stop", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (server.status === "stopping") {
    return res.status(400).json({ error: "Server is already stopping" });
  }

  if (server.status === "deleting") {
    return res.status(400).json({ error: "Server is being deleted" });
  }

  if (
    server.status !== "running" &&
    server.status !== "starting" &&
    !isServerRunning(id)
  ) {
    return res.status(400).json({ error: "Server is not running" });
  }

  const result = await stopServer(id);

  if (result.success) {
    res.json({ success: true, message: result.message });
  } else {
    res.status(400).json({ error: result.message });
  }
});

// GET /api/servers/:id/install-status - Get installation progress and buffered output
router.get("/:id/install-status", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  res.json(getInstallationProgress(id));
});

// POST /api/servers/:id/cancel-install - Cancel installation and clean up
router.post("/:id/cancel-install", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const cancelled = cancelAndCleanupInstallation(id);

  if (cancelled) {
    res.status(202).json({
      success: true,
      message: "Installation cancellation started",
    });
  } else {
    res
      .status(400)
      .json({ error: "No active or queued installation to cancel" });
  }
});

// PUT /api/servers/:id/launch-params - Update launch parameters
router.put("/:id/launch-params", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { launchParams } = req.body as { launchParams: string };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (typeof launchParams !== "string") {
    return res.status(400).json({ error: "launchParams is required" });
  }

  updateServerLaunchParams(id, launchParams);
  res.json({ success: true, message: "Launch parameters updated" });
});

// PUT /api/servers/:id/profiles-path - Update profiles path
router.put("/:id/profiles-path", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { profilesPath } = req.body as { profilesPath: string };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (typeof profilesPath !== "string" || profilesPath.trim() === "") {
    return res.status(400).json({ error: "profilesPath is required" });
  }

  updateServerProfilesPath(id, profilesPath.trim());
  res.json({ success: true, message: "Profiles path updated" });
});

// GET /api/servers/:id/directories - List subdirectories in the server install path
router.get("/:id/directories", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!fs.existsSync(server.installPath)) {
    return res.json({ directories: [] });
  }

  try {
    const entries = fs.readdirSync(server.installPath, {
      withFileTypes: true,
    });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    res.json({ directories });
  } catch {
    res.json({ directories: [] });
  }
});

// PUT /api/servers/:id/ports - Update server ports
router.put("/:id/ports", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { port, queryPort } = req.body as {
    port: number;
    queryPort: number | null;
  };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (typeof port !== "number" || port < 1 || port > 65535) {
    return res.status(400).json({ error: "Invalid port number (1-65535)" });
  }

  if (
    queryPort !== null &&
    (typeof queryPort !== "number" || queryPort < 1 || queryPort > 65535)
  ) {
    return res
      .status(400)
      .json({ error: "Invalid query port number (1-65535)" });
  }

  // Check for port conflicts with other servers (exclude self)
  const otherServers = getUsedPorts().filter((s) => s.id !== id);
  const allUsedPorts = new Set<number>();
  for (const s of otherServers) {
    for (const p of getAllPortsFromRules(s.port, s.gameId)) {
      allUsedPorts.add(p);
    }
  }

  const newPorts = getAllPortsFromRules(port, server.gameId);
  const conflicts: string[] = [];
  for (const p of newPorts) {
    if (allUsedPorts.has(p)) {
      const conflictServer = otherServers.find((s) =>
        getAllPortsFromRules(s.port, s.gameId).includes(p),
      );
      conflicts.push(
        `Port ${p} is already used by "${conflictServer?.name || "unknown"}"`,
      );
    }
    if (STEAM_RESERVED_PORT_RANGES.some(([lo, hi]) => p >= lo && p <= hi)) {
      conflicts.push(`Port ${p} is in the Steam reserved range (27030-27050)`);
    }
  }

  if (conflicts.length > 0) {
    return res.status(400).json({
      error: `Port conflict: ${conflicts.join(". ")}`,
    });
  }

  updateServerPorts(id, port, queryPort);

  // Update firewall rules in background
  updateFirewallRules(
    {
      name: server.name,
      port: server.port,
      installPath: server.installPath,
      executable: server.executable,
      gameId: server.gameId,
    },
    {
      name: server.name,
      port,
      installPath: server.installPath,
      executable: server.executable,
      gameId: server.gameId,
    },
  )
    .then((result) => {
      broadcast("firewall:updated", { serverId: id, ...result });
    })
    .catch((err) => {
      logger.error("[Firewall] Failed to update rules after port change:", err);
    });

  res.json({ success: true, message: "Ports updated" });
});

// PUT /api/servers/:id/name - Update server name
router.put("/:id/name", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { name } = req.body as { name: string };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "Name is required" });
  }

  if (name.trim().length > 100) {
    return res
      .status(400)
      .json({ error: "Name must be 100 characters or less" });
  }

  updateServerName(id, name.trim());

  // Update firewall rules with new name in background
  updateFirewallRules(
    {
      name: server.name,
      port: server.port,
      installPath: server.installPath,
      executable: server.executable,
      gameId: server.gameId,
    },
    {
      name: name.trim(),
      port: server.port,
      installPath: server.installPath,
      executable: server.executable,
      gameId: server.gameId,
    },
  )
    .then((result) => {
      broadcast("firewall:updated", { serverId: id, ...result });
    })
    .catch((err) => {
      logger.error("[Firewall] Failed to update rules after name change:", err);
    });

  res.json({ success: true, message: "Server name updated" });
});

// PUT /api/servers/:id/auto-restart - Toggle auto-restart on crash
router.put("/:id/auto-restart", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { autoRestart } = req.body as { autoRestart: boolean };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (typeof autoRestart !== "boolean") {
    return res.status(400).json({ error: "autoRestart must be a boolean" });
  }

  updateServerAutoRestart(id, autoRestart);
  res.json({
    success: true,
    message: autoRestart ? "Auto-restart enabled" : "Auto-restart disabled",
  });
});

// GET /api/servers/:id/schedule - Get restart schedule
router.get("/:id/schedule", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const schedule = getScheduleByServerId(id);
  res.json({ schedule });
});

// PUT /api/servers/:id/schedule - Create or update restart schedule
router.put("/:id/schedule", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const {
    intervalHours,
    warningMinutes,
    warningMessage,
    enabled,
    restartTime,
  } = req.body as {
    intervalHours: number;
    warningMinutes: number[];
    warningMessage: string;
    enabled: boolean;
    restartTime?: string | null;
  };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (
    typeof intervalHours !== "number" ||
    intervalHours < 1 ||
    intervalHours > 168
  ) {
    return res
      .status(400)
      .json({ error: "Interval must be between 1 and 168 hours" });
  }

  if (
    !Array.isArray(warningMinutes) ||
    warningMinutes.some((m) => typeof m !== "number" || m < 1)
  ) {
    return res
      .status(400)
      .json({ error: "Warning minutes must be an array of positive numbers" });
  }

  if (typeof warningMessage !== "string" || warningMessage.trim() === "") {
    return res.status(400).json({ error: "Warning message is required" });
  }

  // Validate restartTime format if provided
  const normalizedRestartTime = restartTime || null;
  if (normalizedRestartTime !== null) {
    if (!/^\d{2}:\d{2}$/.test(normalizedRestartTime)) {
      return res
        .status(400)
        .json({ error: "Restart time must be in HH:mm format" });
    }
    const [h, m] = normalizedRestartTime.split(":").map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      return res
        .status(400)
        .json({ error: "Restart time must be a valid time (00:00 - 23:59)" });
    }
  }

  const schedule = upsertSchedule(
    id,
    intervalHours,
    warningMinutes,
    warningMessage.trim(),
    enabled,
    normalizedRestartTime,
  );

  // Start or clear the schedule based on enabled state
  if (enabled && server.status === "running") {
    startSchedule(id);
  } else {
    clearSchedule(id);
  }

  res.json({ success: true, message: "Schedule updated", schedule });
});

// DELETE /api/servers/:id/schedule - Delete restart schedule
router.delete("/:id/schedule", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  clearSchedule(id);
  deleteScheduleFromDb(id);
  res.json({ success: true, message: "Schedule deleted" });
});

// ─── Scheduled Messages (RCON broadcasts) ────────────────────────────────

// GET /api/servers/:id/messages - Get all scheduled messages
router.get("/:id/messages", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const messages = getMessagesByServerId(id);
  res.json({ messages });
});

// POST /api/servers/:id/messages - Create a new scheduled message
router.post("/:id/messages", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { message, intervalMinutes, enabled } = req.body as {
    message: string;
    intervalMinutes: number;
    enabled: boolean;
  };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ error: "Message text is required" });
  }

  if (
    typeof intervalMinutes !== "number" ||
    intervalMinutes < 1 ||
    intervalMinutes > 1440
  ) {
    return res
      .status(400)
      .json({ error: "Interval must be between 1 and 1440 minutes" });
  }

  const newMessage = createMessage(
    id,
    message.trim(),
    intervalMinutes,
    enabled ?? true,
  );

  // Reload broadcaster if server is running
  reloadMessageBroadcaster(id);

  res.json({
    success: true,
    message: "Message created",
    serverMessage: newMessage,
  });
});

// PUT /api/servers/:id/messages/:messageId - Update a scheduled message
router.put("/:id/messages/:messageId", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const messageId = parseInt(req.params.messageId, 10);
  const { message, intervalMinutes, enabled } = req.body as {
    message: string;
    intervalMinutes: number;
    enabled: boolean;
  };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const existing = getMessageById(messageId);
  if (!existing || existing.serverId !== id) {
    return res.status(404).json({ error: "Message not found" });
  }

  if (typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ error: "Message text is required" });
  }

  if (
    typeof intervalMinutes !== "number" ||
    intervalMinutes < 1 ||
    intervalMinutes > 1440
  ) {
    return res
      .status(400)
      .json({ error: "Interval must be between 1 and 1440 minutes" });
  }

  const updated = updateMessage(
    messageId,
    message.trim(),
    intervalMinutes,
    enabled,
  );

  // Reload broadcaster if server is running
  reloadMessageBroadcaster(id);

  res.json({
    success: true,
    message: "Message updated",
    serverMessage: updated,
  });
});

// DELETE /api/servers/:id/messages/:messageId - Delete a scheduled message
router.delete("/:id/messages/:messageId", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const messageId = parseInt(req.params.messageId, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const existing = getMessageById(messageId);
  if (!existing || existing.serverId !== id) {
    return res.status(404).json({ error: "Message not found" });
  }

  deleteMessageFromDb(messageId);

  // Reload broadcaster if server is running
  reloadMessageBroadcaster(id);

  res.json({ success: true, message: "Message deleted" });
});

// ─── Template Variables ─────────────────────────────────────────────────

// GET /api/servers/variables/builtins - List all built-in variable names
router.get("/variables/builtins", (_req: Request, res: Response) => {
  res.json({ variables: BUILTIN_VARIABLES });
});

// GET /api/servers/:id/variables - Get custom variables for a server
router.get("/:id/variables", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const variables = getVariablesByServerId(id);
  res.json({ variables });
});

// PUT /api/servers/:id/variables - Create or update a custom variable
router.put("/:id/variables", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { name, value } = req.body as { name: string; value: string };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  // Validate name: uppercase letters, numbers, underscores only
  const cleanName = (name || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "");
  if (!cleanName || cleanName.length < 1) {
    return res.status(400).json({
      error: "Variable name is required (letters, numbers, underscores)",
    });
  }

  // Prevent overriding built-in variables
  const builtinNames: string[] = BUILTIN_VARIABLES.map((v) => v.name);
  if (builtinNames.includes(cleanName)) {
    return res.status(400).json({
      error: `"${cleanName}" is a built-in variable and cannot be overridden`,
    });
  }

  if (typeof value !== "string") {
    return res.status(400).json({ error: "Variable value is required" });
  }

  const variable = upsertVariable(id, cleanName, value);
  res.json({ success: true, message: "Variable saved", variable });
});

// DELETE /api/servers/:id/variables/:variableId - Delete a custom variable
router.delete("/:id/variables/:variableId", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const variableId = parseInt(req.params.variableId, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  deleteVariableFromDb(variableId);
  res.json({ success: true, message: "Variable deleted" });
});

// ── Update Restart Settings ──────────────────────────────────────────

// GET /api/servers/:id/update-restart - Get update restart settings
router.get("/:id/update-restart", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const settings = getUpdateRestartSettings(id);
  res.json(settings);
});

// PUT /api/servers/:id/update-restart - Update update restart settings
router.put("/:id/update-restart", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const {
    enabled,
    delayMinutes,
    warningMinutes,
    warningMessage,
    checkIntervalMinutes,
    checkGameUpdates,
  } = req.body;

  upsertUpdateRestartSettings(id, {
    enabled: enabled ?? false,
    delayMinutes: delayMinutes ?? 5,
    warningMinutes: warningMinutes ?? [5, 1],
    warningMessage:
      warningMessage ??
      "Server restarting in {MINUTES} minute(s) for mod updates",
    checkIntervalMinutes: checkIntervalMinutes ?? 30,
    checkGameUpdates: checkGameUpdates ?? true,
  });

  // Restart the update checker with new settings
  startUpdateChecker(id);

  const settings = getUpdateRestartSettings(id);
  res.json({
    success: true,
    message: "Update restart settings saved",
    settings,
  });
});

// POST /api/servers/:id/check-updates - Manually trigger an update check
router.post("/:id/check-updates", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  try {
    const result = await triggerUpdateCheck(id);
    const parts: string[] = [];
    if (result.updatedMods.length > 0) {
      parts.push(`${result.updatedMods.length} mod update(s)`);
    }
    if (result.gameUpdateAvailable) {
      parts.push(`game server update (build ${result.latestBuildId})`);
    }
    res.json({
      success: true,
      message:
        parts.length > 0
          ? `Updates found: ${parts.join(", ")}`
          : result.loginRequired
            ? "Game update check skipped - Steam login required"
            : "Everything is up to date",
      updatedMods: result.updatedMods,
      gameUpdateAvailable: result.gameUpdateAvailable,
      latestBuildId: result.latestBuildId,
      steamcmdOutput: result.steamcmdOutput,
      loginRequired: result.loginRequired,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: `Failed to check for updates: ${msg}` });
  }
});

// POST /api/servers/:id/open-folder - Open server folder in file explorer
router.post("/:id/open-folder", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!fs.existsSync(server.installPath)) {
    return res.status(404).json({ error: "Server folder not found" });
  }

  // Open folder in Windows Explorer
  exec(`explorer.exe "${server.installPath}"`);
  res.json({ success: true, message: "Folder opened" });
});

// GET /api/servers/:id/disk-usage - Get disk usage of server directory
router.get("/:id/disk-usage", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!fs.existsSync(server.installPath)) {
    return res.json({ sizeBytes: 0, sizeFormatted: "0 B" });
  }

  try {
    const totalSize = await getDirectorySizeAsync(server.installPath);
    res.json({
      sizeBytes: totalSize,
      sizeFormatted: formatBytes(totalSize),
    });
  } catch (err) {
    logger.error(`[DiskUsage] Error calculating size for server ${id}:`, err);
    res.status(500).json({ error: "Failed to calculate disk usage" });
  }
});

// GET /api/servers/:id/config-status - Check if game config files have been generated
router.get("/:id/config-status", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const gameDef = getGameDefinition(server.gameId);
  const configFiles = gameDef?.configFiles || [];
  const adapter = getGameAdapter(server.gameId);

  // Check if adapter supports isConfigGenerated (e.g. ARK)
  // If the server is currently in its first start, config files may exist but
  // are still incomplete — report as not generated until startup is done.
  const configGenerated = isFirstStartInProgress(id)
    ? false
    : adapter?.isConfigGenerated
      ? adapter.isConfigGenerated(server)
      : true; // Non-ARK games always have config generated after install

  // Check which config files actually exist (skip directory entries)
  const fileEntries = configFiles.filter((f) => !f.endsWith("/"));
  const existingFiles = fileEntries
    .map((f) => path.basename(f))
    .filter((basename) => {
      const fullPath = fileEntries.find((f) => path.basename(f) === basename);
      return fullPath && fs.existsSync(path.join(server.installPath, fullPath));
    });

  // Preserve trailing / for directory entries so the frontend can distinguish them
  const configFileLabels = configFiles.map((f) =>
    f.endsWith("/") ? f : path.basename(f),
  );

  res.json({
    configGenerated,
    configFiles: configFileLabels,
    existingFiles,
  });
});

// PUT /api/servers/:id/initial-settings - Save initial config settings as launch params
router.put("/:id/initial-settings", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (server.status === "running") {
    return res.status(400).json({
      error: "Cannot modify settings while server is running.",
    });
  }

  const { sessionName, adminPassword, serverPassword, maxPlayers, map } =
    req.body as {
      sessionName?: string;
      adminPassword?: string;
      serverPassword?: string;
      maxPlayers?: number;
      map?: string;
    };

  // Get current launch params (base template)
  const gameDef = getGameDefinition(server.gameId);
  let launchParams = server.launchParams || gameDef?.defaultLaunchParams || "";

  // Helper: set or replace a ?Key=Value in the launch params
  const setParam = (key: string, value: string): void => {
    const regex = new RegExp(`([?])${key}=[^?\\s]*`, "i");
    if (regex.test(launchParams)) {
      launchParams = launchParams.replace(regex, `$1${key}=${value}`);
    } else {
      // Insert before first -flag argument (UE4 convention)
      const dashIndex = launchParams.search(/\s+-/);
      const param = `?${key}=${value}`;
      if (dashIndex !== -1) {
        launchParams =
          launchParams.slice(0, dashIndex) +
          param +
          launchParams.slice(dashIndex);
      } else {
        launchParams += param;
      }
    }
  };

  // Replace map name (first token before the first '?' in launch params)
  if (map !== undefined && map.trim()) {
    const firstQ = launchParams.indexOf("?");
    if (firstQ !== -1) {
      launchParams = map.trim() + launchParams.slice(firstQ);
    } else {
      launchParams = map.trim();
    }
  }

  if (sessionName !== undefined) {
    // ARK: SessionName may only contain letters, digits, hyphens, underscores
    const sanitizedSessionName = sessionName.replace(/[^a-zA-Z0-9_-]/g, "_");
    setParam("SessionName", sanitizedSessionName);
  }
  if (adminPassword !== undefined)
    setParam("ServerAdminPassword", adminPassword);
  if (serverPassword !== undefined) setParam("ServerPassword", serverPassword);
  if (maxPlayers !== undefined) setParam("MaxPlayers", String(maxPlayers));

  updateServerLaunchParams(id, launchParams);

  res.json({
    success: true,
    message: "Initial settings saved to launch parameters",
  });
});

// GET /api/servers/:id/config - Get server configuration file
router.get("/:id/config", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  // Determine config file from game definition
  const gameDef = getGameDefinition(server.gameId);
  const configFiles = gameDef?.configFiles;
  if (!configFiles || configFiles.length === 0) {
    return res.status(404).json({
      error: "No config file defined for this game",
    });
  }

  // Filter out directory entries — they are handled by the browse API
  const editableConfigFiles = configFiles.filter((f) => !f.endsWith("/"));

  // Support ?file= query param for multi-file games (default: first non-directory file)
  const requestedFile = req.query.file as string | undefined;
  const configFileName = requestedFile
    ? editableConfigFiles.find(
        (f) => path.basename(f) === requestedFile || f === requestedFile,
      )
    : editableConfigFiles[0];

  if (!configFileName) {
    return res.status(400).json({
      error: "Requested config file is not allowed for this game",
    });
  }

  const configPath = path.join(server.installPath, configFileName);

  if (!fs.existsSync(configPath)) {
    // For ARK's Game.ini: auto-create with section header since ARK doesn't
    // generate this file on first start (it's purely for user overrides)
    if (
      server.gameId === "ark" &&
      path.basename(configFileName) === "Game.ini"
    ) {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const initialContent = "[/Script/ShooterGame.ShooterGameMode]\n";
      fs.writeFileSync(configPath, initialContent, "utf-8");
      console.log(`[ARK] Created initial Game.ini at ${configPath}`);
    } else {
      return res.status(404).json({
        error: "Config file not found",
        path: configPath,
      });
    }
  }

  try {
    const content = readGameFile(configPath);
    // Preserve trailing / for directory entries so the frontend can distinguish them
    const configFileLabels = configFiles.map((f) =>
      f.endsWith("/") ? f : path.basename(f),
    );
    res.json({
      fileName: path.basename(configFileName),
      path: configPath,
      content,
      configFiles: configFileLabels,
    });
  } catch (err) {
    res.status(500).json({
      error: `Failed to read config: ${(err as Error).message}`,
    });
  }
});

// PUT /api/servers/:id/config - Update server configuration file
router.put("/:id/config", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  let { content } = req.body as { content: string };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (server.status === "running") {
    return res.status(400).json({
      error: "Cannot modify config while server is running. Stop it first.",
    });
  }

  if (typeof content !== "string") {
    return res.status(400).json({ error: "Content is required" });
  }

  // Determine config file from game definition
  const gameDef = getGameDefinition(server.gameId);
  const configFiles = gameDef?.configFiles;
  if (!configFiles || configFiles.length === 0) {
    return res.status(404).json({
      error: "No config file defined for this game",
    });
  }

  // Filter out directory entries — they are handled by the browse API
  const editableConfigFiles = configFiles.filter((f) => !f.endsWith("/"));

  // Support ?file= query param for multi-file games (default: first non-directory file)
  const requestedFile = req.query.file as string | undefined;
  const configFileName = requestedFile
    ? editableConfigFiles.find(
        (f) => path.basename(f) === requestedFile || f === requestedFile,
      )
    : editableConfigFiles[0];

  if (!configFileName) {
    return res.status(400).json({
      error: "Requested config file is not allowed for this game",
    });
  }

  const configPath = path.join(server.installPath, configFileName);

  try {
    // Create backup before overwriting
    if (fs.existsSync(configPath)) {
      const backupPath = `${configPath}.backup`;
      fs.copyFileSync(configPath, backupPath);
    }

    // ARK: sanitize SessionName in the INI content before writing
    if (
      server.gameId === "ark" &&
      path.basename(configFileName) === "GameUserSettings.ini"
    ) {
      const sessionNameMatch = content.match(/^(SessionName\s*=\s*)(.+)$/im);
      if (sessionNameMatch) {
        const sanitized = sessionNameMatch[2].replace(/[^a-zA-Z0-9_-]/g, "_");
        if (sanitized !== sessionNameMatch[2]) {
          content = content.replace(
            sessionNameMatch[0],
            `${sessionNameMatch[1]}${sanitized}`,
          );
        }
      }
    }

    fs.writeFileSync(configPath, content, "utf-8");

    // ARK sync: when saving GameUserSettings.ini, sync critical values back to launch params
    // so that getAdditionalLaunchParams() always reflects the latest config
    if (
      server.gameId === "ark" &&
      path.basename(configFileName) === "GameUserSettings.ini"
    ) {
      try {
        const adapter = getGameAdapter(server.gameId);
        if (adapter) {
          const savedContent = content;
          let launchParams = server.launchParams || "";
          const gameDef = getGameDefinition(server.gameId);
          if (!launchParams && gameDef) {
            launchParams = gameDef.defaultLaunchParams;
          }

          // Helper to extract INI values from the saved content
          const getIniVal = (section: string, key: string): string | null => {
            const lines = savedContent.split("\n");
            const sectionHeader = `[${section}]`;
            let inSection = false;
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.toLowerCase() === sectionHeader.toLowerCase()) {
                inSection = true;
                continue;
              }
              if (trimmed.startsWith("[")) {
                if (inSection) break;
                continue;
              }
              if (inSection) {
                const eqIdx = trimmed.indexOf("=");
                if (eqIdx > 0) {
                  const k = trimmed.substring(0, eqIdx).trim();
                  if (k.toLowerCase() === key.toLowerCase()) {
                    return trimmed.substring(eqIdx + 1).trim();
                  }
                }
              }
            }
            return null;
          };

          // Sync critical values to launch params
          const syncKeys = [
            {
              paramKey: "SessionName",
              iniSection: "SessionSettings",
              iniKey: "SessionName",
            },
            {
              paramKey: "ServerAdminPassword",
              iniSection: "ServerSettings",
              iniKey: "ServerAdminPassword",
            },
            {
              paramKey: "ServerPassword",
              iniSection: "ServerSettings",
              iniKey: "ServerPassword",
            },
            {
              paramKey: "RCONPort",
              iniSection: "ServerSettings",
              iniKey: "RCONPort",
            },
            {
              paramKey: "MaxPlayers",
              iniSection: "/Script/Engine.GameSession",
              iniKey: "MaxPlayers",
            },
          ];

          for (const { paramKey, iniSection, iniKey } of syncKeys) {
            const val = getIniVal(iniSection, iniKey);
            if (val !== null) {
              const regex = new RegExp(`([?])${paramKey}=[^?\\s]*`, "i");
              if (regex.test(launchParams)) {
                launchParams = launchParams.replace(
                  regex,
                  `$1${paramKey}=${val}`,
                );
              } else {
                const dashIndex = launchParams.search(/\s+-/);
                const param = `?${paramKey}=${val}`;
                if (dashIndex !== -1) {
                  launchParams =
                    launchParams.slice(0, dashIndex) +
                    param +
                    launchParams.slice(dashIndex);
                } else {
                  launchParams += param;
                }
              }
            }
          }

          updateServerLaunchParams(id, launchParams);
          logger.info(
            `[ARK] Synced config values to launch params for server ${id}`,
          );
        }
      } catch (syncErr) {
        logger.error(
          `[ARK] Failed to sync config values to launch params:`,
          syncErr,
        );
      }
    }

    res.json({ success: true, message: "Configuration saved" });
  } catch (err) {
    res.status(500).json({
      error: `Failed to save config: ${(err as Error).message}`,
    });
  }
});

// GET /api/servers/:id/files/:filename - Get a specific file from server directory
router.get("/:id/files/:filename", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { filename } = req.params;
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  // Security: Use game adapter to determine allowed files and paths
  const adapter = getGameAdapter(server.gameId);
  const editableFiles = adapter?.getEditableFiles(server) ?? [];
  const fileConfig = editableFiles.find((f) => f.name === filename);

  if (!fileConfig) {
    return res
      .status(403)
      .json({ error: "Access to this file is not allowed" });
  }

  if (!fs.existsSync(fileConfig.path)) {
    return res.json({ content: "", exists: false });
  }

  try {
    const content = readGameFile(fileConfig.path);
    res.json({ content, exists: true });
  } catch (err) {
    res.status(500).json({
      error: `Failed to read file: ${(err as Error).message}`,
    });
  }
});

// PUT /api/servers/:id/files/:filename - Update a specific file in server directory
router.put("/:id/files/:filename", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { filename } = req.params;
  const { content } = req.body as { content: string };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  // Security: Use game adapter to determine allowed writable files
  const adapter = getGameAdapter(server.gameId);
  const editableFiles = adapter?.getEditableFiles(server) ?? [];
  const fileConfig = editableFiles.find((f) => f.name === filename);

  if (!fileConfig || fileConfig.readonly) {
    return res
      .status(403)
      .json({ error: "Modification of this file is not allowed" });
  }

  if (typeof content !== "string") {
    return res.status(400).json({ error: "Content is required" });
  }

  try {
    fs.writeFileSync(fileConfig.path, content, "utf-8");
    res.json({ success: true, message: "File saved" });
  } catch (err) {
    res.status(500).json({
      error: `Failed to save file: ${(err as Error).message}`,
    });
  }
});

// GET /api/servers/:id/logs - List current + archived log files
router.get("/:id/logs", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return res.status(400).json({ error: "Unknown game type" });
  }
  const logPaths = adapter.getLogPaths(server);
  const current = getCurrentLogs(logPaths);
  const archives = getArchivedSessions(logPaths);

  res.json({ current, archives });
});

// GET /api/servers/:id/logs/content/:filename - Get current log file content
router.get("/:id/logs/content/:filename", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { filename } = req.params;
  const { lines = "0" } = req.query;
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return res.status(400).json({ error: "Unknown game type" });
  }
  const logPaths = adapter.getLogPaths(server);
  const maxLines = parseInt(lines as string, 10) || 0;
  const result = readLogContent(logPaths, filename, maxLines);

  if (!result) {
    return res.status(404).json({ error: "Log file not found or not allowed" });
  }

  res.json({ name: filename, ...result });
});
// GET /api/servers/:id/logs/archive/:session - List files in an archive session
router.get("/:id/logs/archive/:session", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { session } = req.params;
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return res.status(400).json({ error: "Unknown game type" });
  }
  const logPaths = adapter.getLogPaths(server);
  const files = getArchivedSessionFiles(logPaths, session);
  res.json(files);
});

// GET /api/servers/:id/logs/archive/:session/:filename - Read archived log content
router.get(
  "/:id/logs/archive/:session/:filename",
  (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const { session, filename } = req.params;
    const { lines = "0" } = req.query;
    const server = getServerById(id);

    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    const adapter = getGameAdapter(server.gameId);
    if (!adapter) {
      return res.status(400).json({ error: "Unknown game type" });
    }
    const logPaths = adapter.getLogPaths(server);
    const maxLines = parseInt(lines as string, 10) || 0;
    const result = readLogContent(logPaths, filename, maxLines, session);

    if (!result) {
      return res
        .status(404)
        .json({ error: "Archived log file not found or not allowed" });
    }

    res.json({ name: filename, ...result });
  },
);

// DELETE /api/servers/:id/logs/archive/:session - Delete an archive session
router.delete("/:id/logs/archive/:session", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { session } = req.params;
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return res.status(400).json({ error: "Unknown game type" });
  }
  const logPaths = adapter.getLogPaths(server);
  const deleted = deleteArchivedSession(logPaths, session);
  if (!deleted) {
    return res.status(404).json({ error: "Archive session not found" });
  }

  res.json({ success: true, message: "Archive deleted" });
});

// GET /api/servers/:id/logs/settings - Get log settings
router.get("/:id/logs/settings", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  res.json(getLogSettingsFromDb(id));
});

// PUT /api/servers/:id/logs/settings - Update log settings
router.put("/:id/logs/settings", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { archiveOnStart, retentionDays } = req.body as {
    archiveOnStart?: boolean;
    retentionDays?: number;
  };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const current = getLogSettingsFromDb(id);
  updateLogSettingsInDb(
    id,
    archiveOnStart ?? current.archiveOnStart,
    retentionDays ?? current.retentionDays,
  );

  res.json({ success: true, message: "Log settings updated" });
});

// DELETE /api/servers/:id - Delete server and all files
router.delete("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { confirmName, deleteBackups } = req.body as {
    confirmName?: string;
    deleteBackups?: boolean;
  };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (server.status === "running") {
    return res
      .status(400)
      .json({ error: "Cannot delete running server. Stop it first." });
  }

  if (server.status === "deleting") {
    return res.status(400).json({ error: "Server is already being deleted." });
  }

  // Require name confirmation for safety
  if (!confirmName || confirmName !== server.name) {
    return res.status(400).json({
      error: "Server name confirmation required",
      requiredName: server.name,
    });
  }

  // Mark as deleting immediately and respond — actual deletion happens in background
  updateServerStatus(id, "deleting", null);
  broadcast("server:status", { serverId: id, status: "deleting" });

  // Fire-and-forget background deletion
  performBackgroundDeletion(
    id,
    server.name,
    server.gameId,
    server.port,
    server.installPath,
    deleteBackups === true,
  );

  res.status(202).json({
    success: true,
    message: "Server deletion started",
  });
});

// ==================== MOD ROUTES ====================

// GET /api/servers/:id/mods - List all mods for a server
router.get("/:id/mods", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const mods = getModsByServerId(id);
  const modParams = generateModParams(id);

  res.json({
    mods,
    modParam: modParams.modParam,
    serverModParam: modParams.serverModParam,
  });
});

// POST /api/servers/:id/mods - Add a new mod
router.post("/:id/mods", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { workshopInput, isServerMod } = req.body as {
    workshopInput: string;
    isServerMod?: boolean;
  };

  const server = getServerById(id);
  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!workshopInput) {
    return res.status(400).json({ error: "Workshop ID or URL required" });
  }

  // Parse workshop ID from input
  const workshopId = parseWorkshopId(workshopInput);
  if (!workshopId) {
    return res.status(400).json({ error: "Invalid Workshop ID or URL format" });
  }

  // Check if mod already exists for this server
  const existingMods = getModsByServerId(id);
  if (existingMods.some((m) => m.workshopId === workshopId)) {
    return res.status(400).json({ error: "Mod already added to this server" });
  }

  // Try to get mod info from Steam Workshop
  let modName = `Workshop Mod ${workshopId}`;
  try {
    const modInfo = await getWorkshopModInfo(workshopId);
    if (modInfo?.name) {
      modName = modInfo.name;
    }
  } catch (e) {
    logger.info(`Could not fetch mod info for ${workshopId}:`, e);
  }

  // Create mod entry
  const modId = createMod({
    serverId: id,
    workshopId,
    name: modName,
    isServerMod: isServerMod || false,
  });

  // Start installation in background
  installMod(modId).catch((err) => {
    logger.error(`Mod installation failed for ${modId}:`, err);
  });

  res.json({
    success: true,
    message: "Mod added and installation started",
    modId,
  });
});

// PUT /api/servers/:id/mods/:modId - Update mod settings
router.put("/:id/mods/:modId", (req: Request, res: Response) => {
  const serverId = parseInt(req.params.id, 10);
  const modId = parseInt(req.params.modId, 10);
  const { enabled, loadOrder } = req.body as {
    enabled?: boolean;
    loadOrder?: number;
  };

  const server = getServerById(serverId);
  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const mods = getModsByServerId(serverId);
  const mod = mods.find((m) => m.id === modId);
  if (!mod) {
    return res.status(404).json({ error: "Mod not found" });
  }

  if (typeof enabled === "boolean") {
    updateModEnabled(modId, enabled);
  }

  if (typeof loadOrder === "number") {
    updateModLoadOrder(modId, loadOrder);
  }

  // Sync active mods in game config (e.g. ARK's GameUserSettings.ini)
  try {
    const adapter = getGameAdapter(server.gameId);
    const updatedMods = getModsByServerId(serverId);
    adapter?.updateActiveModsInConfig?.(server.installPath, updatedMods);
  } catch (err) {
    logger.error(
      `[Mods] Failed to update config after mod change: ${(err as Error).message}`,
    );
  }

  res.json({ success: true, message: "Mod updated" });
});

// POST /api/servers/:id/mods/:modId/reinstall - Reinstall a mod
router.post(
  "/:id/mods/:modId/reinstall",
  async (req: Request, res: Response) => {
    const serverId = parseInt(req.params.id, 10);
    const modId = parseInt(req.params.modId, 10);

    const server = getServerById(serverId);
    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    const mods = getModsByServerId(serverId);
    const mod = mods.find((m) => m.id === modId);
    if (!mod) {
      return res.status(404).json({ error: "Mod not found" });
    }

    // Start reinstallation
    installMod(modId).catch((err) => {
      logger.error(`Mod reinstallation failed for ${modId}:`, err);
    });

    res.json({ success: true, message: "Mod reinstallation started" });
  },
);

// POST /api/servers/:id/mods/:modId/cancel - Cancel an active mod download
router.post("/:id/mods/:modId/cancel", (req: Request, res: Response) => {
  const serverId = parseInt(req.params.id, 10);
  const modId = parseInt(req.params.modId, 10);

  const server = getServerById(serverId);
  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const mods = getModsByServerId(serverId);
  const mod = mods.find((m) => m.id === modId);
  if (!mod) {
    return res.status(404).json({ error: "Mod not found" });
  }

  const result = cancelModInstallation(modId);
  if (result.success) {
    broadcast("mod:error", {
      modId,
      serverId,
      error: "Installation cancelled by user",
    });
    res.json(result);
  } else {
    res.status(404).json({ error: result.message });
  }
});

// DELETE /api/servers/:id/mods/:modId - Remove a mod
router.delete("/:id/mods/:modId", async (req: Request, res: Response) => {
  const serverId = parseInt(req.params.id, 10);
  const modId = parseInt(req.params.modId, 10);

  const server = getServerById(serverId);
  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const mods = getModsByServerId(serverId);
  const mod = mods.find((m) => m.id === modId);
  if (!mod) {
    return res.status(404).json({ error: "Mod not found" });
  }

  const result = await uninstallMod(modId);

  if (result.success) {
    // Sync active mods in game config after removal
    try {
      const adapter = getGameAdapter(server.gameId);
      const remainingMods = getModsByServerId(serverId);
      adapter?.updateActiveModsInConfig?.(server.installPath, remainingMods);
    } catch (err) {
      logger.error(
        `[Mods] Failed to update config after mod removal: ${(err as Error).message}`,
      );
    }
    res.json({ success: true, message: result.message });
  } else {
    res.status(500).json({ error: result.message });
  }
});

// POST /api/servers/:id/mods/reorder - Reorder mods
router.post("/:id/mods/reorder", (req: Request, res: Response) => {
  const serverId = parseInt(req.params.id, 10);
  const { modIds } = req.body as { modIds: number[] };

  const server = getServerById(serverId);
  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!Array.isArray(modIds)) {
    return res.status(400).json({ error: "modIds array required" });
  }

  // Update load order based on array position
  modIds.forEach((modId, index) => {
    updateModLoadOrder(modId, index);
  });

  // Sync active mods in game config after reorder
  try {
    const adapter = getGameAdapter(server.gameId);
    const updatedMods = getModsByServerId(serverId);
    adapter?.updateActiveModsInConfig?.(server.installPath, updatedMods);
  } catch (err) {
    logger.error(
      `[Mods] Failed to update config after mod reorder: ${(err as Error).message}`,
    );
  }

  res.json({ success: true, message: "Mod order updated" });
});

// POST /api/servers/:id/mods/export-modlist - Export mods as mod list files
router.post("/:id/mods/export-modlist", (req: Request, res: Response) => {
  const serverId = parseInt(req.params.id, 10);
  const { includeDisabled } = req.body as { includeDisabled?: boolean };

  const server = getServerById(serverId);
  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const adapter = getGameAdapter(server.gameId);
  if (
    !adapter?.definition.capabilities.modListFiles ||
    !adapter.exportModList
  ) {
    return res
      .status(400)
      .json({ error: "Mod list files are not supported for this game" });
  }

  const mods = getModsByServerId(serverId);
  const backupDir = getBackupStoragePath(serverId);

  try {
    const result = adapter.exportModList(
      mods,
      server.installPath,
      backupDir,
      includeDisabled ?? false,
    );

    const parts: string[] = [];
    if (result.modListWritten) parts.push("mod_list.txt");
    if (result.serverModListWritten) parts.push("server_mod_list.txt");

    const backupParts: string[] = [];
    if (result.backups.modList) backupParts.push(result.backups.modList);
    if (result.backups.serverModList)
      backupParts.push(result.backups.serverModList);

    let message =
      parts.length > 0
        ? `Exported ${parts.join(" and ")}`
        : "No mods to export";
    if (backupParts.length > 0) {
      message += `. Backups created: ${backupParts.join(", ")}`;
    }

    res.json({
      success: true,
      message,
      modListWritten: result.modListWritten,
      serverModListWritten: result.serverModListWritten,
      backups: result.backups,
    });
  } catch (err) {
    logger.error(
      `[Mods] Failed to export mod list for server ${serverId}: ${(err as Error).message}`,
    );
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/servers/:id/mods/import-modlist - Import mods from mod list files
router.post("/:id/mods/import-modlist", async (req: Request, res: Response) => {
  const serverId = parseInt(req.params.id, 10);

  const server = getServerById(serverId);
  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter?.definition.capabilities.modListFiles || !adapter.parseModList) {
    return res
      .status(400)
      .json({ error: "Mod list files are not supported for this game" });
  }

  const parsed = adapter.parseModList(server.installPath);
  const allWorkshopIds = [
    ...parsed.clientMods.map((id) => ({ workshopId: id, isServerMod: false })),
    ...parsed.serverMods.map((id) => ({ workshopId: id, isServerMod: true })),
  ];

  if (allWorkshopIds.length === 0) {
    return res.json({
      success: true,
      message: "No mods found in mod list files",
      imported: 0,
      skipped: 0,
    });
  }

  const existingMods = getModsByServerId(serverId);
  const existingWorkshopIds = new Set(existingMods.map((m) => m.workshopId));

  let imported = 0;
  let skipped = 0;

  for (const entry of allWorkshopIds) {
    if (existingWorkshopIds.has(entry.workshopId)) {
      skipped++;
      continue;
    }

    let modName = `Workshop Mod ${entry.workshopId}`;
    try {
      const modInfo = await getWorkshopModInfo(entry.workshopId);
      if (modInfo?.name) {
        modName = modInfo.name;
      }
    } catch (e) {
      logger.info(`Could not fetch mod info for ${entry.workshopId}:`, e);
    }

    const modId = createMod({
      serverId,
      workshopId: entry.workshopId,
      name: modName,
      isServerMod: entry.isServerMod,
    });

    installMod(modId).catch((err) => {
      logger.error(`Mod installation failed for ${modId}:`, err);
    });

    existingWorkshopIds.add(entry.workshopId);
    imported++;
  }

  res.json({
    success: true,
    message:
      imported > 0
        ? `Imported ${imported} mod${imported !== 1 ? "s" : ""}, skipped ${skipped} already installed`
        : `All ${skipped} mods are already installed`,
    imported,
    skipped,
  });
});

// ==================== Player Routes ====================

// GET /api/servers/:id/players - Get player overview (online + history)
router.get("/:id/players", (req: Request, res: Response) => {
  const serverId = parseInt(req.params.id, 10);

  const server = getServerById(serverId);
  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const onlinePlayers = getOnlinePlayers(serverId);
  const playerSummaries = getPlayerSummaries(serverId);

  res.json({
    online: onlinePlayers.map((p) => ({
      steamId: p.steamId,
      playerName: p.playerName,
      characterId: p.characterId,
      connectedAt: p.connectedAt,
    })),
    players: playerSummaries,
    onlineCount: onlinePlayers.length,
  });
});

// POST /api/servers/:id/players/whitelist - Add a player to the whitelist
router.post("/:id/players/whitelist", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { characterId, playerName } = req.body as {
    characterId: string;
    playerName?: string;
  };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!characterId || characterId.length < 10) {
    return res.status(400).json({ error: "Valid player ID is required" });
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return res.status(400).json({ error: "Unknown game type" });
  }

  try {
    const result = adapter.addToPlayerList(
      server,
      "whitelist",
      characterId,
      playerName,
    );
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    res.json({ success: true, message: result.message });
  } catch (err) {
    res.status(500).json({
      error: `Failed to update whitelist: ${(err as Error).message}`,
    });
  }
});

// DELETE /api/servers/:id/players/whitelist - Remove a player from the whitelist
router.delete("/:id/players/whitelist", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { characterId } = req.body as { characterId: string };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!characterId) {
    return res.status(400).json({ error: "Player ID is required" });
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return res.status(400).json({ error: "Unknown game type" });
  }

  try {
    const result = adapter.removeFromPlayerList(
      server,
      "whitelist",
      characterId,
    );
    if (!result.success) {
      return res.status(404).json({ error: result.message });
    }
    res.json({ success: true, message: result.message });
  } catch (err) {
    res.status(500).json({
      error: `Failed to update whitelist: ${(err as Error).message}`,
    });
  }
});

// POST /api/servers/:id/players/ban - Add a player to the ban list
router.post("/:id/players/ban", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { characterId, playerName } = req.body as {
    characterId: string;
    playerName?: string;
  };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!characterId || characterId.length < 10) {
    return res.status(400).json({ error: "Valid player ID is required" });
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return res.status(400).json({ error: "Unknown game type" });
  }

  try {
    const result = adapter.addToPlayerList(
      server,
      "ban",
      characterId,
      playerName,
    );
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    res.json({ success: true, message: result.message });
  } catch (err) {
    res.status(500).json({
      error: `Failed to update ban list: ${(err as Error).message}`,
    });
  }
});

// DELETE /api/servers/:id/players/ban - Remove a player from the ban list
router.delete("/:id/players/ban", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { characterId } = req.body as { characterId: string };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!characterId) {
    return res.status(400).json({ error: "Player ID is required" });
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return res.status(400).json({ error: "Unknown game type" });
  }

  try {
    const result = adapter.removeFromPlayerList(server, "ban", characterId);
    if (!result.success) {
      return res.status(404).json({ error: result.message });
    }
    res.json({ success: true, message: result.message });
  } catch (err) {
    res.status(500).json({
      error: `Failed to update ban list: ${(err as Error).message}`,
    });
  }
});

// GET /api/servers/:id/players/whitelist-content - Get whitelist content as text
router.get("/:id/players/whitelist-content", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return res.status(400).json({ error: "Unknown game type" });
  }

  const content = adapter.getPlayerListContent(server, "whitelist");
  res.json({ content });
});

// GET /api/servers/:id/players/ban-content - Get ban list content as text
router.get("/:id/players/ban-content", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return res.status(400).json({ error: "Unknown game type" });
  }

  const content = adapter.getPlayerListContent(server, "ban");
  res.json({ content });
});

// POST /api/servers/:id/players/priority - Add a player to the priority queue
router.post("/:id/players/priority", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { steamId, playerName } = req.body as {
    steamId: string;
    playerName?: string;
  };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!steamId || steamId.length < 10) {
    return res.status(400).json({ error: "Valid Steam ID is required" });
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return res.status(400).json({ error: "Unknown game type" });
  }

  try {
    const result = adapter.addToPlayerList(
      server,
      "priority",
      steamId,
      playerName,
    );
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    res.json({ success: true, message: result.message });
  } catch (err) {
    res.status(500).json({
      error: `Failed to update priority queue: ${(err as Error).message}`,
    });
  }
});

// DELETE /api/servers/:id/players/priority - Remove a player from the priority queue
router.delete("/:id/players/priority", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { steamId } = req.body as { steamId: string };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!steamId) {
    return res.status(400).json({ error: "Steam ID is required" });
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return res.status(400).json({ error: "Unknown game type" });
  }

  try {
    const result = adapter.removeFromPlayerList(server, "priority", steamId);
    if (!result.success) {
      return res.status(404).json({ error: result.message });
    }
    res.json({ success: true, message: result.message });
  } catch (err) {
    res.status(500).json({
      error: `Failed to update priority queue: ${(err as Error).message}`,
    });
  }
});

// GET /api/servers/:id/players/priority-content - Get priority queue content as text
router.get("/:id/players/priority-content", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return res.status(400).json({ error: "Unknown game type" });
  }

  const content = adapter.getPlayerListContent(server, "priority");
  res.json({ content });
});

// POST /api/servers/:id/players/:playerId/message - Send a direct message to a player
router.post(
  "/:id/players/:playerId/message",
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const { playerId } = req.params;
    const { message, playerName } = req.body as {
      message: string;
      playerName?: string;
    };
    const server = getServerById(id);

    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    if (
      !message ||
      typeof message !== "string" ||
      message.trim().length === 0
    ) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (server.status !== "running") {
      return res.status(400).json({ error: "Server is not running" });
    }

    const adapter = getGameAdapter(server.gameId);
    if (!adapter?.sendDirectMessage) {
      return res
        .status(400)
        .json({ error: "This game does not support direct messages" });
    }

    const rcon = getRconConnection(server.id);
    if (!rcon || !rcon.isConnected()) {
      return res.status(400).json({ error: "RCON is not connected" });
    }

    try {
      const sent = await adapter.sendDirectMessage(
        rcon,
        playerId,
        playerName || "",
        message.trim(),
      );
      if (!sent) {
        return res.status(404).json({ error: "Player not found on server" });
      }
      res.json({ success: true, message: "Message sent" });
    } catch (err) {
      logger.error(
        `[Servers] Failed to send direct message to ${playerId} on server ${id}:`,
        err,
      );
      res.status(500).json({
        error: `Failed to send message: ${(err as Error).message}`,
      });
    }
  },
);

// ==================== FIREWALL ROUTES ====================

// GET /api/servers/:id/firewall - Check firewall rule status
router.get("/:id/firewall", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  try {
    const status = await checkFirewallRules({
      name: server.name,
      port: server.port,
      installPath: server.installPath,
      executable: server.executable,
      gameId: server.gameId,
    });
    res.json(status);
  } catch (err) {
    res.status(500).json({
      error: `Failed to check firewall rules: ${(err as Error).message}`,
    });
  }
});

// POST /api/servers/:id/firewall - Add/repair missing firewall rules
router.post("/:id/firewall", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  try {
    const result = await addFirewallRules({
      name: server.name,
      port: server.port,
      installPath: server.installPath,
      executable: server.executable,
      gameId: server.gameId,
    });
    broadcast("firewall:updated", { serverId: id, ...result });
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: `Failed to add firewall rules: ${(err as Error).message}`,
    });
  }
});

// DELETE /api/servers/:id/firewall - Remove all firewall rules for a server
router.delete("/:id/firewall", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  try {
    const result = await removeFirewallRules(
      server.name,
      server.gameId,
      server.port,
    );
    broadcast("firewall:updated", { serverId: id, ...result });
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: `Failed to remove firewall rules: ${(err as Error).message}`,
    });
  }
});

// ── File Browser API ─────────────────────────────────────────────────
// Allows browsing and editing files within adapter-defined root directories.
// Security: User sends a rootKey (e.g., "profiles") — resolved to an absolute
// path by the game adapter. Relative paths are validated against the root to
// prevent path traversal.

const TEXT_FILE_EXTENSIONS = new Set([
  ".cfg",
  ".xml",
  ".json",
  ".txt",
  ".ini",
  ".cpp",
  ".properties",
  ".log",
  ".adm",
  ".rpt",
  ".dayzprofile",
  ".md",
  ".yaml",
  ".yml",
  ".conf",
  ".config",
  ".toml",
  ".env",
  ".bat",
  ".sh",
  ".ps1",
  ".csv",
  ".htm",
  ".html",
  ".sqf",
  ".hpp",
  ".c",
  ".h",
]);

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_FILE_EXTENSIONS.has(ext) || ext === "";
}

function resolveAndValidateBrowsePath(
  server: GameServer,
  rootKey: string,
  relativePath: string,
): { rootDir: string; absolutePath: string } | { error: string } {
  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return { error: "No adapter found for this game" };
  }

  const roots = adapter.getBrowsableRoots(server);
  const root = roots.find((r) => r.key === rootKey);
  if (!root) {
    return {
      error: `Browsable root '${rootKey}' is not defined for this game`,
    };
  }

  const rootDir = root.resolvePath(server);

  // Normalize and validate the relative path
  const normalized = path.normalize(relativePath).replace(/\\/g, "/");
  if (
    normalized.startsWith("..") ||
    normalized.includes("/../") ||
    normalized === ".."
  ) {
    return { error: "Path traversal is not allowed" };
  }

  const absolutePath = path.resolve(rootDir, normalized);

  // Ensure resolved path is within the root
  if (!absolutePath.startsWith(rootDir)) {
    return { error: "Path traversal is not allowed" };
  }

  return { rootDir, absolutePath };
}

interface FileTreeEntry {
  name: string;
  type: "file" | "directory";
  size?: number;
  extension?: string;
  editable?: boolean;
  children?: FileTreeEntry[];
}

function buildFileTree(
  dirPath: string,
  depth: number,
  maxDepth: number,
): FileTreeEntry[] {
  if (depth >= maxDepth || !fs.existsSync(dirPath)) {
    return [];
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const result: FileTreeEntry[] = [];

    // Sort: directories first, then files, alphabetically
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          type: "directory",
          children: buildFileTree(fullPath, depth + 1, maxDepth),
        });
      } else if (entry.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          const ext = path.extname(entry.name).toLowerCase();
          result.push({
            name: entry.name,
            type: "file",
            size: stats.size,
            extension: ext || undefined,
            editable: isTextFile(entry.name),
          });
        } catch {
          // Skip files we can't stat
        }
      }
    }

    return result;
  } catch {
    return [];
  }
}

// GET /api/servers/:id/browse/roots - List available browsable roots for this server
router.get("/:id/browse/roots", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const adapter = getGameAdapter(server.gameId);
  const roots = adapter?.getBrowsableRoots(server) ?? [];

  res.json({
    roots: roots.map((r) => ({ key: r.key, label: r.label })),
  });
});

// GET /api/servers/:id/browse/tree - Get recursive directory tree
router.get("/:id/browse/tree", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const rootKey = req.query.root as string;
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!rootKey) {
    return res
      .status(400)
      .json({ error: "Query parameter 'root' is required" });
  }

  const resolved = resolveAndValidateBrowsePath(server, rootKey, ".");
  if ("error" in resolved) {
    return res.status(400).json({ error: resolved.error });
  }

  const maxDepth = Math.min(parseInt(req.query.depth as string) || 10, 15);
  const tree = buildFileTree(resolved.rootDir, 0, maxDepth);

  res.json({ root: rootKey, tree });
});

// GET /api/servers/:id/browse/list - List a single directory level (lazy-loading)
router.get(
  "/:id/browse/list",
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id, 10);
    const rootKey = req.query.root as string;
    const dirPath = (req.query.path as string) || ".";
    const server = getServerById(id);

    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    if (!rootKey) {
      res.status(400).json({ error: "Query parameter 'root' is required" });
      return;
    }

    const resolved = resolveAndValidateBrowsePath(server, rootKey, dirPath);
    if ("error" in resolved) {
      res.status(400).json({ error: resolved.error });
      return;
    }

    try {
      const stat = await fsPromises.stat(resolved.absolutePath);
      if (!stat.isDirectory()) {
        res.status(400).json({ error: "Path is not a directory" });
        return;
      }

      const entries = await fsPromises.readdir(resolved.absolutePath, {
        withFileTypes: true,
      });

      // Sort: directories first, then files, alphabetically
      const sorted = entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      const result: {
        name: string;
        type: "file" | "directory";
        size?: number;
        extension?: string;
        editable?: boolean;
        hasChildren?: boolean;
      }[] = [];

      for (const entry of sorted) {
        const fullPath = path.join(resolved.absolutePath, entry.name);
        if (entry.isDirectory()) {
          // Check if directory has any children (non-recursive, lightweight)
          let hasChildren = false;
          try {
            const children = await fsPromises.readdir(fullPath, {
              recursive: false,
            });
            hasChildren = children.length > 0;
          } catch {
            // Can't read → treat as empty
          }
          result.push({
            name: entry.name,
            type: "directory",
            hasChildren,
          });
        } else if (entry.isFile()) {
          try {
            const stats = await fsPromises.stat(fullPath);
            const ext = path.extname(entry.name).toLowerCase();
            result.push({
              name: entry.name,
              type: "file",
              size: stats.size,
              extension: ext || undefined,
              editable: isTextFile(entry.name),
            });
          } catch {
            // Skip files we can't stat
          }
        }
      }

      res.json({ path: dirPath, entries: result });
    } catch (err) {
      res.status(500).json({
        error: `Failed to list directory: ${(err as Error).message}`,
      });
    }
  },
);

// GET /api/servers/:id/browse/file - Read a file
router.get("/:id/browse/file", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const rootKey = req.query.root as string;
  const filePath = req.query.path as string;
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!rootKey || !filePath) {
    return res
      .status(400)
      .json({ error: "Query parameters 'root' and 'path' are required" });
  }

  const resolved = resolveAndValidateBrowsePath(server, rootKey, filePath);
  if ("error" in resolved) {
    return res.status(400).json({ error: resolved.error });
  }

  if (!fs.existsSync(resolved.absolutePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  try {
    const stats = fs.statSync(resolved.absolutePath);
    if (!stats.isFile()) {
      return res.status(400).json({ error: "Path is not a file" });
    }

    if (!isTextFile(resolved.absolutePath)) {
      return res
        .status(400)
        .json({ error: "Binary files cannot be opened in the editor" });
    }

    const content = readGameFile(resolved.absolutePath);
    res.json({
      content,
      size: stats.size,
      path: filePath,
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: `Failed to read file: ${(err as Error).message}` });
  }
});

// PUT /api/servers/:id/browse/file - Write/update a file
router.put("/:id/browse/file", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const {
    root: rootKey,
    path: filePath,
    content,
  } = req.body as {
    root: string;
    path: string;
    content: string;
  };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!rootKey || !filePath || typeof content !== "string") {
    return res
      .status(400)
      .json({ error: "Fields 'root', 'path', and 'content' are required" });
  }

  const resolved = resolveAndValidateBrowsePath(server, rootKey, filePath);
  if ("error" in resolved) {
    return res.status(400).json({ error: resolved.error });
  }

  if (!fs.existsSync(resolved.absolutePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  if (!isTextFile(resolved.absolutePath)) {
    return res.status(400).json({ error: "Only text files can be edited" });
  }

  try {
    fs.writeFileSync(resolved.absolutePath, content, "utf-8");
    res.json({ success: true, message: "File saved" });
  } catch (err) {
    res
      .status(500)
      .json({ error: `Failed to save file: ${(err as Error).message}` });
  }
});

// POST /api/servers/:id/browse/file - Create a new file
router.post("/:id/browse/file", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const {
    root: rootKey,
    path: filePath,
    content,
  } = req.body as {
    root: string;
    path: string;
    content?: string;
  };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!rootKey || !filePath) {
    return res
      .status(400)
      .json({ error: "Fields 'root' and 'path' are required" });
  }

  if (!isTextFile(filePath)) {
    return res.status(400).json({ error: "Only text files can be created" });
  }

  const resolved = resolveAndValidateBrowsePath(server, rootKey, filePath);
  if ("error" in resolved) {
    return res.status(400).json({ error: resolved.error });
  }

  if (fs.existsSync(resolved.absolutePath)) {
    return res.status(409).json({ error: "File already exists" });
  }

  try {
    // Ensure parent directory exists
    const parentDir = path.dirname(resolved.absolutePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(resolved.absolutePath, content ?? "", "utf-8");
    res.json({ success: true, message: "File created" });
  } catch (err) {
    res
      .status(500)
      .json({ error: `Failed to create file: ${(err as Error).message}` });
  }
});

// DELETE /api/servers/:id/browse/file - Delete a file
router.delete("/:id/browse/file", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const rootKey = req.query.root as string;
  const filePath = req.query.path as string;
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!rootKey || !filePath) {
    return res
      .status(400)
      .json({ error: "Query parameters 'root' and 'path' are required" });
  }

  const resolved = resolveAndValidateBrowsePath(server, rootKey, filePath);
  if ("error" in resolved) {
    return res.status(400).json({ error: resolved.error });
  }

  if (!fs.existsSync(resolved.absolutePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  try {
    const stats = fs.statSync(resolved.absolutePath);
    if (!stats.isFile()) {
      return res.status(400).json({ error: "Path is not a file" });
    }
    fs.unlinkSync(resolved.absolutePath);
    res.json({ success: true, message: "File deleted" });
  } catch (err) {
    res
      .status(500)
      .json({ error: `Failed to delete file: ${(err as Error).message}` });
  }
});

// POST /api/servers/:id/browse/directory - Create a directory
router.post("/:id/browse/directory", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { root: rootKey, path: dirPath } = req.body as {
    root: string;
    path: string;
  };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!rootKey || !dirPath) {
    return res
      .status(400)
      .json({ error: "Fields 'root' and 'path' are required" });
  }

  const resolved = resolveAndValidateBrowsePath(server, rootKey, dirPath);
  if ("error" in resolved) {
    return res.status(400).json({ error: resolved.error });
  }

  if (fs.existsSync(resolved.absolutePath)) {
    return res.status(409).json({ error: "Directory already exists" });
  }

  try {
    fs.mkdirSync(resolved.absolutePath, { recursive: true });
    res.json({ success: true, message: "Directory created" });
  } catch (err) {
    res
      .status(500)
      .json({ error: `Failed to create directory: ${(err as Error).message}` });
  }
});

// DELETE /api/servers/:id/browse/directory - Delete an empty directory
router.delete("/:id/browse/directory", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const rootKey = req.query.root as string;
  const dirPath = req.query.path as string;
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!rootKey || !dirPath) {
    return res
      .status(400)
      .json({ error: "Query parameters 'root' and 'path' are required" });
  }

  // Prevent deleting the root directory itself
  const normalizedDir = path.normalize(dirPath).replace(/\\/g, "/");
  if (normalizedDir === "." || normalizedDir === "/" || normalizedDir === "") {
    return res.status(400).json({ error: "Cannot delete the root directory" });
  }

  const resolved = resolveAndValidateBrowsePath(server, rootKey, dirPath);
  if ("error" in resolved) {
    return res.status(400).json({ error: resolved.error });
  }

  if (!fs.existsSync(resolved.absolutePath)) {
    return res.status(404).json({ error: "Directory not found" });
  }

  try {
    const stats = fs.statSync(resolved.absolutePath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: "Path is not a directory" });
    }

    const entries = fs.readdirSync(resolved.absolutePath);
    if (entries.length > 0) {
      return res.status(400).json({
        error: "Directory is not empty. Only empty directories can be deleted.",
      });
    }

    fs.rmdirSync(resolved.absolutePath);
    res.json({ success: true, message: "Directory deleted" });
  } catch (err) {
    res
      .status(500)
      .json({ error: `Failed to delete directory: ${(err as Error).message}` });
  }
});

// POST /api/servers/:id/browse/rename - Rename a file or directory
router.post("/:id/browse/rename", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const {
    root: rootKey,
    from,
    to,
  } = req.body as {
    root: string;
    from: string;
    to: string;
  };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (!rootKey || !from || !to) {
    return res
      .status(400)
      .json({ error: "Fields 'root', 'from', and 'to' are required" });
  }

  const resolvedFrom = resolveAndValidateBrowsePath(server, rootKey, from);
  if ("error" in resolvedFrom) {
    return res.status(400).json({ error: resolvedFrom.error });
  }

  const resolvedTo = resolveAndValidateBrowsePath(server, rootKey, to);
  if ("error" in resolvedTo) {
    return res.status(400).json({ error: resolvedTo.error });
  }

  if (!fs.existsSync(resolvedFrom.absolutePath)) {
    return res.status(404).json({ error: "Source path not found" });
  }

  if (fs.existsSync(resolvedTo.absolutePath)) {
    return res.status(409).json({ error: "Destination path already exists" });
  }

  try {
    // Ensure parent directory of destination exists
    const parentDir = path.dirname(resolvedTo.absolutePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.renameSync(resolvedFrom.absolutePath, resolvedTo.absolutePath);
    res.json({ success: true, message: "Renamed successfully" });
  } catch (err) {
    res
      .status(500)
      .json({ error: `Failed to rename: ${(err as Error).message}` });
  }
});

// ── Download (single file or folder as ZIP) ───────────────────────────
router.get("/:id/browse/download", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const rootKey = req.query.root as string;
  const filePath = req.query.path as string;

  const server = getServerById(id);
  if (!server) return res.status(404).json({ error: "Server not found" });
  if (!rootKey || !filePath) {
    return res
      .status(400)
      .json({ error: "Query parameters 'root' and 'path' are required" });
  }

  const resolved = resolveAndValidateBrowsePath(server, rootKey, filePath);
  if ("error" in resolved)
    return res.status(400).json({ error: resolved.error });
  if (!fs.existsSync(resolved.absolutePath)) {
    return res.status(404).json({ error: "Path not found" });
  }

  try {
    const stats = fs.statSync(resolved.absolutePath);

    if (stats.isFile()) {
      // Single file — stream directly
      return res.download(resolved.absolutePath);
    }

    if (stats.isDirectory()) {
      // Directory — create ZIP on-the-fly
      const dirName = path.basename(resolved.absolutePath);
      const zip = new AdmZip();
      zip.addLocalFolder(resolved.absolutePath, dirName);
      const zipBuffer = zip.toBuffer();

      res.set("Content-Type", "application/zip");
      res.set("Content-Disposition", `attachment; filename="${dirName}.zip"`);
      res.set("Content-Length", String(zipBuffer.length));
      return res.send(zipBuffer);
    }

    return res
      .status(400)
      .json({ error: "Path is neither a file nor a directory" });
  } catch (err) {
    res
      .status(500)
      .json({ error: `Download failed: ${(err as Error).message}` });
  }
});

// ── Upload (multiple files via multipart form-data) ───────────────────
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

router.post(
  "/:id/browse/upload",
  upload.array("files", 100),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const rootKey = req.body.root as string;
    const targetPath = req.body.path as string;
    const files = req.files as Express.Multer.File[] | undefined;

    const server = getServerById(id);
    if (!server) return res.status(404).json({ error: "Server not found" });
    if (!rootKey) {
      return res.status(400).json({ error: "Field 'root' is required" });
    }

    // Resolve target directory (use "." for root if no path provided)
    const resolved = resolveAndValidateBrowsePath(
      server,
      rootKey,
      targetPath || ".",
    );
    if ("error" in resolved)
      return res.status(400).json({ error: resolved.error });

    // Ensure target is a directory (create if needed)
    if (fs.existsSync(resolved.absolutePath)) {
      const stats = fs.statSync(resolved.absolutePath);
      if (!stats.isDirectory()) {
        return res
          .status(400)
          .json({ error: "Target path is not a directory" });
      }
    } else {
      fs.mkdirSync(resolved.absolutePath, { recursive: true });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files provided" });
    }

    const movedFiles: string[] = [];
    const errors: string[] = [];

    for (const file of files) {
      // Sanitize filename — strip path separators, reject traversal attempts
      const safeName = path.basename(file.originalname);
      if (
        !safeName ||
        safeName === ".." ||
        safeName === "." ||
        safeName.includes("/") ||
        safeName.includes("\\")
      ) {
        errors.push(`Rejected unsafe filename: ${file.originalname}`);
        // Clean up temp file
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* ignore */
        }
        continue;
      }

      const destPath = path.join(resolved.absolutePath, safeName);

      // Verify destination is still within the root
      if (!destPath.startsWith(resolved.rootDir)) {
        errors.push(`Path traversal detected for: ${safeName}`);
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* ignore */
        }
        continue;
      }

      try {
        // Move from temp to target (rename is fast on same fs, otherwise copy+delete)
        await fsPromises.rename(file.path, destPath).catch(async () => {
          // Cross-device: copy then delete
          await fsPromises.copyFile(file.path, destPath);
          await fsPromises.unlink(file.path);
        });
        movedFiles.push(safeName);
      } catch (err) {
        errors.push(`Failed to save ${safeName}: ${(err as Error).message}`);
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* ignore */
        }
      }
    }

    if (movedFiles.length === 0) {
      return res.status(400).json({
        error: "No files were uploaded successfully",
        details: errors,
      });
    }

    res.json({
      success: true,
      message: `${movedFiles.length} file(s) uploaded`,
      files: movedFiles,
      ...(errors.length > 0 ? { warnings: errors } : {}),
    });
  },
);

// Handle multer file-size errors
router.use(
  (
    err: Error & { code?: string },
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large (max 500 MB)" });
    }
    next(err);
  },
);

// ── Backup Endpoints ─────────────────────────────────────────────────

// List backups for a server
router.get("/:id/backups", (req: Request, res: Response) => {
  const serverId = parseInt(req.params.id);
  const server = getServerById(serverId);
  if (!server) return res.status(404).json({ error: "Server not found" });

  const backups = getBackupsByServerId(serverId);
  const enriched = backups.map((b) => ({
    ...b,
    fileExists:
      b.status === "success" ? backupFileExists(serverId, b.id) : undefined,
  }));
  res.json({ backups: enriched });
});

// Create a new backup
router.post("/:id/backups", async (req: Request, res: Response) => {
  const serverId = parseInt(req.params.id);
  const server = getServerById(serverId);
  if (!server) return res.status(404).json({ error: "Server not found" });

  if (isBackupRunning(serverId)) {
    return res
      .status(409)
      .json({ error: "A backup is already running for this server" });
  }

  const { name, tag } = req.body || {};

  // Start backup in background (non-blocking)
  createBackup(serverId, {
    name: name || undefined,
    tag: tag || undefined,
    trigger: "manual",
  }).catch((err) =>
    logger.error(`[Backup] Unhandled error: ${(err as Error).message}`),
  );

  res.json({ success: true, message: "Backup started" });
});

// Delete a backup
router.delete("/:id/backups/:backupId", (req: Request, res: Response) => {
  const serverId = parseInt(req.params.id);
  const server = getServerById(serverId);
  if (!server) return res.status(404).json({ error: "Server not found" });

  const result = deleteBackup(serverId, req.params.backupId);
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }
  res.json(result);
});

// Update a backup (name, tag)
router.patch("/:id/backups/:backupId", (req: Request, res: Response) => {
  const serverId = parseInt(req.params.id);
  const server = getServerById(serverId);
  if (!server) return res.status(404).json({ error: "Server not found" });

  const { name, tag } = req.body || {};

  const updates: { name?: string | null; tag?: string | null } = {};
  if (name !== undefined) {
    updates.name = typeof name === "string" && name.trim() ? name.trim() : null;
  }
  if (tag !== undefined) {
    updates.tag = typeof tag === "string" && tag.trim() ? tag.trim() : null;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  updateBackupRecord(req.params.backupId, updates);
  res.json({ success: true });
});

// Restore a backup
router.post(
  "/:id/backups/:backupId/restore",
  async (req: Request, res: Response) => {
    const serverId = parseInt(req.params.id);
    const server = getServerById(serverId);
    if (!server) return res.status(404).json({ error: "Server not found" });

    if (isServerRunning(serverId)) {
      return res
        .status(400)
        .json({ error: "Server must be stopped before restoring" });
    }

    const { preRestoreBackup } = req.body || {};
    const result = await restoreBackup(serverId, req.params.backupId, {
      preRestoreBackup: !!preRestoreBackup,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    res.json(result);
  },
);

// Download a backup zip
router.get("/:id/backups/:backupId/download", (req: Request, res: Response) => {
  const serverId = parseInt(req.params.id);
  const server = getServerById(serverId);
  if (!server) return res.status(404).json({ error: "Server not found" });

  const filePath = getBackupFilePath(serverId, req.params.backupId);
  if (!filePath) {
    return res.status(404).json({ error: "Backup file not found" });
  }

  res.download(filePath);
});

// Get backup settings
router.get("/:id/backup-settings", (req: Request, res: Response) => {
  const serverId = parseInt(req.params.id);
  const server = getServerById(serverId);
  if (!server) return res.status(404).json({ error: "Server not found" });

  const adapter = getGameAdapter(server.gameId);
  const defaultPaths = adapter
    ? adapter.getBackupPaths(server)
    : { savePaths: [], configPaths: [], excludePatterns: [] };

  const settings = getBackupSettingsFromDb(serverId) ?? {
    serverId,
    enabled: false,
    fullBackup: false,
    backupBeforeStart: false,
    backupBeforeRestart: false,
    backupBeforeUpdate: false,
    retentionCount: 5,
    retentionDays: 30,
    customIncludePaths: [
      ...defaultPaths.savePaths,
      ...defaultPaths.configPaths,
    ],
    customExcludePaths: [...defaultPaths.excludePatterns],
  };

  // Auto-populate custom paths with defaults when empty (first load or legacy data)
  if (
    settings.customIncludePaths.length === 0 &&
    settings.customExcludePaths.length === 0
  ) {
    settings.customIncludePaths = [
      ...defaultPaths.savePaths,
      ...defaultPaths.configPaths,
    ];
    settings.customExcludePaths = [...defaultPaths.excludePatterns];
  }

  res.json({ settings, defaultPaths });
});

// Update backup settings
router.put("/:id/backup-settings", (req: Request, res: Response) => {
  const serverId = parseInt(req.params.id);
  const server = getServerById(serverId);
  if (!server) return res.status(404).json({ error: "Server not found" });

  const body = req.body || {};

  // Validate numeric fields
  if (
    body.retentionCount !== undefined &&
    (typeof body.retentionCount !== "number" || body.retentionCount < 0)
  ) {
    return res
      .status(400)
      .json({ error: "retentionCount must be a non-negative number" });
  }
  if (
    body.retentionDays !== undefined &&
    (typeof body.retentionDays !== "number" || body.retentionDays < 0)
  ) {
    return res
      .status(400)
      .json({ error: "retentionDays must be a non-negative number" });
  }

  // Validate array fields
  if (
    body.customIncludePaths !== undefined &&
    !Array.isArray(body.customIncludePaths)
  ) {
    return res
      .status(400)
      .json({ error: "customIncludePaths must be an array" });
  }
  if (
    body.customExcludePaths !== undefined &&
    !Array.isArray(body.customExcludePaths)
  ) {
    return res
      .status(400)
      .json({ error: "customExcludePaths must be an array" });
  }

  upsertBackupSettings(serverId, body);

  const settings = getBackupSettingsFromDb(serverId);
  res.json({ success: true, settings });
});

export { router as serversRouter };

/**
 * Recursively calculate the total size of a directory in bytes
 */
async function getDirectorySizeAsync(dirPath: string): Promise<number> {
  let totalSize = 0;

  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          totalSize += await getDirectorySizeAsync(fullPath);
        } else if (entry.isFile()) {
          totalSize += (await fsPromises.stat(fullPath)).size;
        }
      } catch {
        // Skip files/dirs we can't access
      }
    }
  } catch {
    // Skip dirs we can't read
  }

  return totalSize;
}

/**
 * Format bytes into a human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
