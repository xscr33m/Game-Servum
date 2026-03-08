import { Router, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { logger, broadcast } from "../index.js";
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
  deleteServer,
  getModsByServerId,
  createMod,
  updateModEnabled,
  updateModLoadOrder,
  deleteMod,
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
import { getSteamConfig, getUsedPorts } from "../db/index.js";
import {
  getAllGameDefinitions,
  getGameDefinition,
} from "../services/gameDefinitions.js";
import {
  installServer,
  cancelInstallation,
  isInstalling,
} from "../services/serverInstall.js";
import {
  startServer,
  stopServer,
  isServerRunning,
  checkServerRequirements,
} from "../services/serverProcess.js";
import { startSchedule, clearSchedule } from "../services/scheduler.js";
import { reloadMessageBroadcaster } from "../services/messageBroadcaster.js";
import { BUILTIN_VARIABLES } from "../services/variableResolver.js";
import {
  triggerUpdateCheck,
  startUpdateChecker,
} from "../services/updateChecker.js";
import {
  parseWorkshopId,
  getWorkshopModInfo,
  installMod,
  uninstallMod,
  generateModParams,
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
import type { CreateServerRequest } from "../types/index.js";

const router = Router();

// GET /api/servers/games - List all available game definitions
router.get("/games", (_req: Request, res: Response) => {
  const games = getAllGameDefinitions().map((game) => ({
    id: game.id,
    name: game.name,
    appId: game.appId,
    defaultPort: game.defaultPort,
    portCount: game.portCount,
    queryPort: game.queryPort,
    queryPortOffset: game.queryPortOffset,
    requiresLogin: game.requiresLogin,
    description: game.description,
    defaultLaunchParams: game.defaultLaunchParams,
    firewallRules: game.firewallRules ?? [],
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

  // Collect ALL ports in use across all servers (considering their port ranges)
  const servers = getUsedPorts();
  const allUsedPorts = new Set<number>();
  for (const s of servers) {
    const sDef = getGameDefinition(s.gameId);
    if (sDef) {
      for (let i = 0; i < sDef.portCount; i++) {
        allUsedPorts.add(s.port + i);
      }
      if (sDef.queryPortOffset != null) {
        allUsedPorts.add(s.port + sDef.queryPortOffset);
      }
    } else {
      allUsedPorts.add(s.port);
      if (s.queryPort) allUsedPorts.add(s.queryPort);
    }
  }

  // Find next available base port (stride by portCount for clean ranges)
  let candidate = gameDef.defaultPort;
  const maxPort = 65535;

  while (candidate < maxPort) {
    const portsNeeded: number[] = [];
    for (let i = 0; i < gameDef.portCount; i++) {
      portsNeeded.push(candidate + i);
    }
    if (gameDef.queryPortOffset != null) {
      portsNeeded.push(candidate + gameDef.queryPortOffset);
    }

    if (portsNeeded.every((p) => !allUsedPorts.has(p) && p <= maxPort)) {
      return res.json({
        port: candidate,
        queryPort:
          gameDef.queryPortOffset != null
            ? candidate + gameDef.queryPortOffset
            : null,
        portsUsed: portsNeeded.sort((a, b) => a - b),
      });
    }

    candidate += gameDef.portStride || gameDef.portCount; // stride for clean aligned ranges
  }

  // Fallback: return defaults
  res.json({
    port: gameDef.defaultPort,
    queryPort: gameDef.queryPort || null,
    portsUsed: [gameDef.defaultPort],
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

  // Default install path
  const installPath =
    body.installPath || path.join(config.serversPath, body.name);

  // Check for port conflicts with existing servers (using full port ranges)
  const requestedPort = body.port || gameDef.defaultPort;
  const requestedQueryPort =
    body.queryPort ||
    (gameDef.queryPortOffset != null
      ? requestedPort + gameDef.queryPortOffset
      : null);

  // Collect ALL ports in use across all servers
  const servers = getUsedPorts();
  const allUsedPorts = new Set<number>();
  for (const s of servers) {
    const sDef = getGameDefinition(s.gameId);
    if (sDef) {
      for (let i = 0; i < sDef.portCount; i++) {
        allUsedPorts.add(s.port + i);
      }
      if (sDef.queryPortOffset != null) {
        allUsedPorts.add(s.port + sDef.queryPortOffset);
      }
    } else {
      allUsedPorts.add(s.port);
      if (s.queryPort) allUsedPorts.add(s.queryPort);
    }
  }

  // Check all ports in the requested range
  const conflicts: string[] = [];
  for (let i = 0; i < gameDef.portCount; i++) {
    const p = requestedPort + i;
    if (allUsedPorts.has(p)) {
      const conflictServer = servers.find((s) => {
        const sd = getGameDefinition(s.gameId);
        if (sd) {
          for (let j = 0; j < sd.portCount; j++) {
            if (s.port + j === p) return true;
          }
          if (sd.queryPortOffset != null && s.port + sd.queryPortOffset === p)
            return true;
        }
        return s.port === p || s.queryPort === p;
      });
      conflicts.push(
        `Port ${p} is already used by "${conflictServer?.name || "unknown"}"`,
      );
    }
  }
  if (requestedQueryPort && allUsedPorts.has(requestedQueryPort)) {
    const conflictServer = servers.find((s) => {
      const sd = getGameDefinition(s.gameId);
      if (sd) {
        for (let j = 0; j < sd.portCount; j++) {
          if (s.port + j === requestedQueryPort) return true;
        }
        if (
          sd.queryPortOffset != null &&
          s.port + sd.queryPortOffset === requestedQueryPort
        )
          return true;
      }
      return (
        s.port === requestedQueryPort || s.queryPort === requestedQueryPort
      );
    });
    conflicts.push(
      `Query port ${requestedQueryPort} is already used by "${conflictServer?.name || "unknown"}"`,
    );
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
      (gameDef.queryPortOffset != null
        ? (body.port || gameDef.defaultPort) + gameDef.queryPortOffset
        : null),
    profilesPath: "profiles",
  });

  const server = getServerById(serverId);

  // Start installation in background
  installServer({
    serverId,
    gameId: body.gameId,
    appId: gameDef.appId,
    installPath,
    serverName: body.name,
    useAnonymous: !gameDef.requiresLogin,
    username: steamConfig?.username,
    password: null, // Password is managed by SteamCMD session
  }).catch((err) => {
    logger.error("Installation error:", err);
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

  res.json({ ...server, installing });
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

// POST /api/servers/:id/cancel-install - Cancel installation
router.post("/:id/cancel-install", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const cancelled = cancelInstallation(id);

  if (cancelled) {
    res.json({ success: true, message: "Installation cancelled" });
  } else {
    res.status(400).json({ error: "No active installation to cancel" });
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
  const { intervalHours, warningMinutes, warningMessage, enabled } =
    req.body as {
      intervalHours: number;
      warningMinutes: number[];
      warningMessage: string;
      enabled: boolean;
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

  const schedule = upsertSchedule(
    id,
    intervalHours,
    warningMinutes,
    warningMessage.trim(),
    enabled,
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
    const totalSize = getDirectorySize(server.installPath);
    res.json({
      sizeBytes: totalSize,
      sizeFormatted: formatBytes(totalSize),
    });
  } catch (err) {
    logger.error(`[DiskUsage] Error calculating size for server ${id}:`, err);
    res.status(500).json({ error: "Failed to calculate disk usage" });
  }
});

// GET /api/servers/:id/config - Get server configuration file
router.get("/:id/config", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  // Determine config file based on game
  let configFileName = "serverDZ.cfg"; // Default for DayZ
  if (server.gameId === "7dtd") {
    configFileName = "serverconfig.xml";
  } else if (server.gameId === "rust") {
    configFileName = "server.cfg";
  }

  const configPath = path.join(server.installPath, configFileName);

  if (!fs.existsSync(configPath)) {
    return res.status(404).json({
      error: "Config file not found",
      path: configPath,
    });
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    res.json({
      fileName: configFileName,
      path: configPath,
      content,
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
  const { content } = req.body as { content: string };
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

  // Determine config file based on game
  let configFileName = "serverDZ.cfg";
  if (server.gameId === "7dtd") {
    configFileName = "serverconfig.xml";
  } else if (server.gameId === "rust") {
    configFileName = "server.cfg";
  }

  const configPath = path.join(server.installPath, configFileName);

  try {
    // Create backup before overwriting
    if (fs.existsSync(configPath)) {
      const backupPath = `${configPath}.backup`;
      fs.copyFileSync(configPath, backupPath);
    }

    fs.writeFileSync(configPath, content, "utf-8");
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

  // Security: Only allow specific files
  const allowedFiles = ["ban.txt", "whitelist.txt", "BEServer_x64.cfg"];
  if (!allowedFiles.includes(filename)) {
    return res
      .status(403)
      .json({ error: "Access to this file is not allowed" });
  }

  let filePath: string;
  if (filename === "BEServer_x64.cfg") {
    const resolvedProfiles = path.isAbsolute(server.profilesPath)
      ? server.profilesPath
      : path.join(server.installPath, server.profilesPath);
    filePath = path.join(resolvedProfiles, "BattlEye", filename);
  } else {
    filePath = path.join(server.installPath, filename);
  }

  if (!fs.existsSync(filePath)) {
    return res.json({ content: "", exists: false });
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
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

  // Security: Only allow specific files
  const allowedFiles = ["ban.txt", "whitelist.txt"];
  if (!allowedFiles.includes(filename)) {
    return res
      .status(403)
      .json({ error: "Modification of this file is not allowed" });
  }

  if (typeof content !== "string") {
    return res.status(400).json({ error: "Content is required" });
  }

  let filePath: string;
  filePath = path.join(server.installPath, filename);

  try {
    fs.writeFileSync(filePath, content, "utf-8");
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

  const current = getCurrentLogs(server.installPath, server.profilesPath);
  const archives = getArchivedSessions(server.installPath, server.profilesPath);

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

  const maxLines = parseInt(lines as string, 10) || 0;
  const result = readLogContent(
    server.installPath,
    filename,
    maxLines,
    undefined,
    server.profilesPath,
  );

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

  const files = getArchivedSessionFiles(
    server.installPath,
    session,
    server.profilesPath,
  );
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

    const maxLines = parseInt(lines as string, 10) || 0;
    const result = readLogContent(
      server.installPath,
      filename,
      maxLines,
      session,
      server.profilesPath,
    );

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

  const deleted = deleteArchivedSession(
    server.installPath,
    session,
    server.profilesPath,
  );
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
  const { confirmName } = req.body as { confirmName?: string };
  const server = getServerById(id);

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  if (server.status === "running") {
    return res
      .status(400)
      .json({ error: "Cannot delete running server. Stop it first." });
  }

  // Require name confirmation for safety
  if (!confirmName || confirmName !== server.name) {
    return res.status(400).json({
      error: "Server name confirmation required",
      requiredName: server.name,
    });
  }

  if (isInstalling(id)) {
    cancelInstallation(id);
  }

  // Remove firewall rules before deleting (non-blocking, don't fail deletion)
  try {
    await removeFirewallRules(server.name, server.gameId, server.port);
    logger.info(`[Delete] Removed firewall rules for server: ${server.name}`);
  } catch (err) {
    logger.error(`[Delete] Failed to remove firewall rules: ${err}`);
  }

  // Delete server files
  const installPath = server.installPath;
  let filesDeleted = false;

  if (installPath && fs.existsSync(installPath)) {
    try {
      fs.rmSync(installPath, { recursive: true, force: true });
      filesDeleted = true;
      logger.info(`[Delete] Removed server files: ${installPath}`);
    } catch (err) {
      logger.error(`[Delete] Failed to remove server files: ${err}`);
      return res.status(500).json({
        error: `Failed to delete server files: ${(err as Error).message}`,
      });
    }
  }

  // Delete database entry
  deleteServer(id);

  res.json({
    success: true,
    message: filesDeleted
      ? "Server and all files deleted successfully"
      : "Server entry deleted (no files found)",
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

  res.json({ success: true, message: "Mod order updated" });
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

  if (!characterId || characterId.length < 20) {
    return res.status(400).json({ error: "Valid character ID is required" });
  }

  const filePath = path.join(server.installPath, "whitelist.txt");

  try {
    let content = "";
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, "utf-8");
    }

    // Check if character ID already exists
    if (content.includes(characterId)) {
      return res
        .status(400)
        .json({ error: "Player is already on the whitelist" });
    }

    // Append the character ID with optional player name comment
    const entry = playerName ? `${characterId}\t//${playerName}` : characterId;
    const newContent =
      content.endsWith("\n") || content === ""
        ? `${content}${entry}\n`
        : `${content}\n${entry}\n`;

    fs.writeFileSync(filePath, newContent, "utf-8");
    res.json({
      success: true,
      message: `${playerName || "Player"} added to whitelist`,
    });
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
    return res.status(400).json({ error: "Character ID is required" });
  }

  const filePath = path.join(server.installPath, "whitelist.txt");

  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Whitelist file not found" });
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const filtered = lines.filter(
      (line) => !line.trim().startsWith(characterId),
    );

    if (lines.length === filtered.length) {
      return res
        .status(404)
        .json({ error: "Player not found on the whitelist" });
    }

    fs.writeFileSync(filePath, filtered.join("\n"), "utf-8");
    res.json({ success: true, message: "Player removed from whitelist" });
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

  if (!characterId || characterId.length < 20) {
    return res.status(400).json({ error: "Valid character ID is required" });
  }

  const filePath = path.join(server.installPath, "ban.txt");

  try {
    let content = "";
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, "utf-8");
    }

    // Check if character ID already exists
    if (content.includes(characterId)) {
      return res
        .status(400)
        .json({ error: "Player is already on the ban list" });
    }

    // Append the character ID with optional player name comment
    const entry = playerName ? `${characterId} //${playerName}` : characterId;
    const newContent =
      content.endsWith("\n") || content === ""
        ? `${content}${entry}\n`
        : `${content}\n${entry}\n`;

    fs.writeFileSync(filePath, newContent, "utf-8");
    res.json({
      success: true,
      message: `${playerName || "Player"} added to ban list`,
    });
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
    return res.status(400).json({ error: "Character ID is required" });
  }

  const filePath = path.join(server.installPath, "ban.txt");

  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Ban file not found" });
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const filtered = lines.filter(
      (line) => !line.trim().startsWith(characterId),
    );

    if (lines.length === filtered.length) {
      return res
        .status(404)
        .json({ error: "Player not found on the ban list" });
    }

    fs.writeFileSync(filePath, filtered.join("\n"), "utf-8");
    res.json({ success: true, message: "Player removed from ban list" });
  } catch (err) {
    res.status(500).json({
      error: `Failed to update ban list: ${(err as Error).message}`,
    });
  }
});

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

export { router as serversRouter };

/**
 * Recursively calculate the total size of a directory in bytes
 */
function getDirectorySize(dirPath: string): number {
  let totalSize = 0;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          totalSize += getDirectorySize(fullPath);
        } else if (entry.isFile()) {
          totalSize += fs.statSync(fullPath).size;
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
