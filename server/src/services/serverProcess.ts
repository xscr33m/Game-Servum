/**
 * Server Process Management Service
 *
 * Handles starting, stopping, and monitoring game server processes.
 * Features:
 * - Process spawning with proper working directory
 * - PID tracking in database
 * - Graceful shutdown (SIGTERM on Linux, taskkill on Windows)
 * - Crash detection and status updates
 * - Console output streaming via WebSocket
 */

import { spawn, exec, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { broadcast, logger } from "../index.js";
import {
  getServerById,
  updateServerStatus,
  getAllServers,
  getAppSetting,
  setAppSetting,
} from "../db/index.js";
import {
  getGameAdapter,
  getGameDefinition,
  type GameDefinition,
} from "../games/index.js";
import { generateModParams } from "./modManager.js";
import { startPlayerTracking, stopPlayerTracking } from "./playerTracker.js";
import { archiveLogsBeforeStart, cleanupOldArchives } from "./logManager.js";
import { getLogSettings } from "../db/index.js";
import { startSchedule, clearSchedule } from "./scheduler.js";
import {
  startMessageBroadcaster,
  stopMessageBroadcaster,
} from "./messageBroadcaster.js";
import { startUpdateChecker, stopUpdateChecker } from "./updateChecker.js";
import type { GameServer } from "../types/index.js";

// Track running server processes
const runningProcesses: Map<number, ChildProcess> = new Map();

// Track crash timestamps for auto-restart protection (max 3 crashes in 10 minutes)
const crashHistory: Map<number, number[]> = new Map();
const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const AUTO_RESTART_DELAY_MS = 10000; // 10 seconds delay before restart

/**
 * Read RCON connection config for a server (delegates to game adapter).
 */
function readRconConfig(
  server: GameServer,
  _gameDef?: GameDefinition,
): { password: string; port: number } | null {
  const adapter = getGameAdapter(server.gameId);
  if (!adapter || !adapter.definition.capabilities.rcon) return null;
  return adapter.readRconConfig(server);
}

export interface StartResult {
  success: boolean;
  message: string;
  pid?: number;
}

export interface StopResult {
  success: boolean;
  message: string;
}

export interface RequirementCheck {
  name: string;
  status: "ok" | "warning" | "error";
  message: string;
  link?: string;
}

export interface RequirementsResult {
  ready: boolean;
  checks: RequirementCheck[];
}

/**
 * Start a game server
 */
export function startServer(serverId: number): StartResult {
  const server = getServerById(serverId);

  if (!server) {
    return { success: false, message: "Server not found" };
  }

  if (runningProcesses.has(serverId)) {
    return { success: false, message: "Server is already running" };
  }

  // Get game definition for additional context
  const gameDef = getGameDefinition(server.gameId);

  // Build executable path
  const executablePath = path.join(server.installPath, server.executable);

  if (!fs.existsSync(executablePath)) {
    const errorMsg = `Executable not found: ${executablePath}`;
    logger.error(`[ServerProcess] ${errorMsg}`);
    broadcast("server:status", {
      serverId,
      status: "error",
      pid: null,
      message: errorMsg,
    });
    return {
      success: false,
      message: errorMsg,
    };
  }

  // Game-specific validation and setup (delegates to adapter)
  const adapter = getGameAdapter(server.gameId);
  if (adapter) {
    const preStartErrors = adapter.validatePreStart(server);
    if (preStartErrors.length > 0) {
      const errorMsg = preStartErrors[0];
      logger.error(`[ServerProcess] ${errorMsg}`);
      broadcast("server:status", {
        serverId,
        status: "error",
        pid: null,
        message: errorMsg,
      });
      return {
        success: false,
        message: errorMsg,
      };
    }
  }

  // Resolve profiles path (used by DayZ for logs, crash analysis, etc.)
  const resolvedProfilesPath = path.isAbsolute(server.profilesPath)
    ? server.profilesPath
    : path.join(server.installPath, server.profilesPath);

  // Ensure profiles directory exists (only for games that use it, e.g. DayZ)
  if (gameDef?.capabilities?.profilesPath) {
    if (!fs.existsSync(resolvedProfilesPath)) {
      fs.mkdirSync(resolvedProfilesPath, { recursive: true });
      logger.info(
        `[ServerProcess] Created profiles directory: ${resolvedProfilesPath}`,
      );
    }
  }

  // Parse launch parameters and replace placeholders
  let launchParams = server.launchParams || gameDef?.defaultLaunchParams || "";

  launchParams = launchParams
    .replace(/\{PORT\}/g, server.port.toString())
    .replace(/\{QUERY_PORT\}/g, (server.queryPort ?? server.port).toString())
    .replace(/\{PROFILES\}/g, server.profilesPath)
    .replace(/\{INSTALL_PATH\}/g, server.installPath)
    .replace(/\{SERVER_NAME\}/g, server.name);

  // Append mod parameters if any mods are enabled
  const { modParam, serverModParam } = generateModParams(serverId);
  if (modParam) {
    launchParams += ` ${modParam}`;
    logger.info(`[ServerProcess] Client mods: ${modParam}`);
  }
  if (serverModParam) {
    launchParams += ` ${serverModParam}`;
    logger.info(`[ServerProcess] Server mods: ${serverModParam}`);
  }

  logger.info(`[ServerProcess] Starting server ${serverId}: ${server.name}`);
  logger.info(`[ServerProcess] Executable: ${executablePath}`);
  logger.info(`[ServerProcess] Launch params: ${launchParams}`);
  logger.info(`[ServerProcess] Working dir: ${server.installPath}`);

  // Archive old log files before starting
  const logSettings = getLogSettings(serverId);
  const logPaths = adapter?.getLogPaths(server);
  if (logSettings.archiveOnStart && logPaths) {
    const archivedCount = archiveLogsBeforeStart(logPaths);
    if (archivedCount > 0) {
      logger.info(`[ServerProcess] Archived ${archivedCount} old log files`);
    }
  }

  // Clean up old archives based on retention setting
  if (logSettings.retentionDays > 0 && logPaths) {
    cleanupOldArchives(logPaths, logSettings.retentionDays);
  }

  // Read RCON config BEFORE spawn (game-specific)
  const rconConfig = readRconConfig(server, gameDef);
  if (rconConfig) {
    logger.debug(
      `[ServerProcess] Pre-read RCON config: port=${rconConfig.port}`,
    );
  }

  // Parse arguments - same for all platforms
  const args = parseArguments(launchParams);
  logger.debug(`[ServerProcess] Parsed args: ${JSON.stringify(args)}`);

  // Set starting status before attempting to spawn
  updateServerStatus(serverId, "starting", null);
  broadcast("server:status", {
    serverId,
    status: "starting",
    pid: null,
    message: `Server ${server.name} is starting...`,
  });

  try {
    // Spawn the process directly (works on both Windows and Linux)
    const spawnEnv = adapter
      ? { ...process.env, ...adapter.getSpawnEnvironment(server) }
      : process.env;
    const child = spawn(executablePath, args, {
      cwd: server.installPath,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: spawnEnv,
      shell: false,
    });

    if (!child.pid) {
      return {
        success: false,
        message: "Failed to start process - no PID assigned",
      };
    }

    // Store the process
    runningProcesses.set(serverId, child);

    // Update database with running status, PID, and start timestamp
    const startedAt = new Date().toISOString();
    updateServerStatus(serverId, "running", child.pid, startedAt);

    // Broadcast status update
    broadcast("server:status", {
      serverId,
      status: "running",
      pid: child.pid,
      message: `Server ${server.name} started`,
    });

    // Start player tracking (RCON polling + log backfill)
    startPlayerTracking(
      serverId,
      server.installPath,
      server.port,
      rconConfig || undefined,
    );

    // Capture stdout/stderr to a log file for the LogsTab
    let consoleLogStream: fs.WriteStream | null = null;
    if (logPaths && logPaths.directories.length > 0) {
      const consoleLogDir = logPaths.directories[0];
      if (!fs.existsSync(consoleLogDir)) {
        fs.mkdirSync(consoleLogDir, { recursive: true });
      }
      const consoleLogPath = path.join(consoleLogDir, "console-output.log");
      consoleLogStream = fs.createWriteStream(consoleLogPath, { flags: "w" });
      consoleLogStream.on("error", (err) => {
        logger.error(`[ServerProcess] Console log write error: ${err.message}`);
        consoleLogStream = null;
      });
    }

    // Collect stderr output for error reporting
    let lastStderrOutput = "";

    // Handle stdout
    child.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      logger.debug(`[Server ${serverId}] ${output}`);
      consoleLogStream?.write(output);
      broadcast("server:output", {
        serverId,
        type: "stdout",
        message: output,
      });
    });

    // Handle stderr
    child.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();
      logger.error(`[Server ${serverId}] STDERR: ${output}`);
      // Keep last stderr output for crash reporting
      lastStderrOutput = output;
      consoleLogStream?.write(output);
      broadcast("server:output", {
        serverId,
        type: "stderr",
        message: output,
      });
    });

    // Handle process exit
    child.on("exit", (code, signal) => {
      // Close console log stream
      consoleLogStream?.end();
      consoleLogStream = null;

      logger.info(
        `[ServerProcess] Server ${serverId} exited with code ${code}, signal ${signal}`,
      );
      if (lastStderrOutput) {
        logger.error(`[ServerProcess] Last stderr: ${lastStderrOutput}`);
      }

      // Remove from tracking
      runningProcesses.delete(serverId);

      // Stop player tracking
      stopPlayerTracking(serverId);

      // Clear scheduled restart timers
      clearSchedule(serverId);

      // Clear scheduled message timers
      stopMessageBroadcaster(serverId);

      // Stop update checker
      stopUpdateChecker(serverId);

      // Determine if this was expected (graceful stop) or a crash
      const wasExpected = signal === "SIGTERM" || code === 0;
      const newStatus = wasExpected ? "stopped" : "error";

      // Update database
      updateServerStatus(serverId, newStatus, null);

      // Build error message with details
      let errorMessage = wasExpected
        ? `Server ${server.name} stopped`
        : `Server ${server.name} crashed (exit code: ${code})`;

      // Check for common dependency issues (DirectX, VC++ Runtime, etc.)
      if (!wasExpected) {
        const dependencyError = detectDependencyError(lastStderrOutput, code);
        if (dependencyError) {
          errorMessage = `Server ${server.name}: ${dependencyError}`;
        } else {
          // Try to read game-specific crash logs for more error details
          if (adapter?.analyzeCrash) {
            const logDetails = adapter.analyzeCrash(
              server,
              resolvedProfilesPath,
            );
            if (logDetails) {
              const logDependencyError = detectDependencyError(
                logDetails,
                code,
              );
              if (logDependencyError) {
                errorMessage = `Server ${server.name}: ${logDependencyError}`;
              } else {
                errorMessage += ` - ${logDetails}`;
              }
              logger.info(`[ServerProcess] Crash log details: ${logDetails}`);
            }
          }

          // Add stderr info if available and no dependency error found
          if (
            lastStderrOutput &&
            !errorMessage.includes(lastStderrOutput.trim())
          ) {
            errorMessage += ` - ${lastStderrOutput.trim().substring(0, 200)}`;
          }
        }
      }

      // Broadcast status update
      broadcast("server:status", {
        serverId,
        status: newStatus,
        pid: null,
        message: errorMessage,
      });

      // Auto-restart on crash if enabled
      if (!wasExpected) {
        // Re-read server from DB to get current autoRestart setting
        const currentServer = getServerById(serverId);
        if (currentServer?.autoRestart) {
          // Check crash frequency protection
          const now = Date.now();
          const crashes = crashHistory.get(serverId) || [];
          const recentCrashes = crashes.filter(
            (t) => now - t < CRASH_WINDOW_MS,
          );
          recentCrashes.push(now);
          crashHistory.set(serverId, recentCrashes);

          if (recentCrashes.length > MAX_CRASHES) {
            logger.warn(
              `[ServerProcess] Server ${serverId} crashed ${recentCrashes.length} times in 10 minutes, disabling auto-restart`,
            );
            broadcast("server:status", {
              serverId,
              status: "error",
              pid: null,
              message: `Auto-restart disabled: ${recentCrashes.length} crashes in 10 minutes. Check server logs.`,
            });
          } else {
            logger.info(
              `[ServerProcess] Auto-restarting server ${serverId} in ${AUTO_RESTART_DELAY_MS / 1000}s (crash ${recentCrashes.length}/${MAX_CRASHES})`,
            );
            broadcast("server:status", {
              serverId,
              status: "error",
              pid: null,
              message: `Server crashed. Auto-restarting in ${AUTO_RESTART_DELAY_MS / 1000} seconds... (${recentCrashes.length}/${MAX_CRASHES})`,
            });

            setTimeout(() => {
              // Re-check that user hasn't manually started the server
              if (!runningProcesses.has(serverId)) {
                logger.info(
                  `[ServerProcess] Auto-restart: starting server ${serverId}`,
                );
                startServer(serverId);
              }
            }, AUTO_RESTART_DELAY_MS);
          }
        }
      }
    });

    // Handle spawn errors
    child.on("error", (error) => {
      logger.error(`[ServerProcess] Server ${serverId} error:`, error);

      runningProcesses.delete(serverId);
      stopPlayerTracking(serverId);
      updateServerStatus(serverId, "error", null);

      broadcast("server:status", {
        serverId,
        status: "error",
        pid: null,
        message: `Server error: ${error.message}`,
      });
    });

    // Activate scheduled restart if configured
    startSchedule(serverId);

    // Activate scheduled RCON messages
    startMessageBroadcaster(serverId);

    // Activate update checker
    startUpdateChecker(serverId);

    return {
      success: true,
      message: `Server ${server.name} started successfully`,
      pid: child.pid,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error(`[ServerProcess] Failed to start server ${serverId}:`, error);

    // Broadcast error to UI
    broadcast("server:status", {
      serverId,
      status: "error",
      pid: null,
      message: `Failed to start server: ${errorMessage}`,
    });

    return {
      success: false,
      message: `Failed to start server: ${errorMessage}`,
    };
  }
}

/**
 * Stop a game server
 */
export async function stopServer(serverId: number): Promise<StopResult> {
  const server = getServerById(serverId);

  if (!server) {
    return { success: false, message: "Server not found" };
  }

  const child = runningProcesses.get(serverId);

  if (!child) {
    // Process not in our tracking - check if we have a PID in DB
    if (server.pid) {
      // Try to kill the orphaned process
      return killProcessByPid(server.pid, serverId, server.name);
    }
    return { success: false, message: "Server is not running" };
  }

  logger.info(`[ServerProcess] Stopping server ${serverId}: ${server.name}`);

  // Set stopping status immediately
  updateServerStatus(serverId, "stopping", server.pid);
  broadcast("server:status", {
    serverId,
    status: "stopping",
    pid: server.pid,
    message: `Server ${server.name} is stopping...`,
  });

  return new Promise((resolve) => {
    // Set a timeout for forceful termination
    const forceKillTimeout = setTimeout(() => {
      logger.warn(`[ServerProcess] Force killing server ${serverId}`);
      if (process.platform === "win32") {
        // Windows: Force kill with taskkill
        exec(`taskkill /PID ${child.pid} /T /F`, (error) => {
          if (error) {
            logger.error(`[ServerProcess] Force kill error:`, error);
          }
        });
      } else {
        child.kill("SIGKILL");
      }
    }, 10000); // 10 second timeout for graceful shutdown

    // Listen for exit to clear the timeout
    child.once("exit", () => {
      clearTimeout(forceKillTimeout);
      resolve({
        success: true,
        message: `Server ${server.name} stopped`,
      });
    });

    // Send graceful termination signal
    if (process.platform === "win32") {
      // Windows: Use taskkill for graceful termination
      // /T kills child processes too
      exec(`taskkill /PID ${child.pid} /T`, (error) => {
        if (error) {
          logger.error(`[ServerProcess] taskkill error:`, error);
          // Fall back to process.kill
          child.kill();
        }
      });
    } else {
      // Linux/Mac: SIGTERM for graceful shutdown
      child.kill("SIGTERM");
    }
  });
}

/**
 * Kill a process by PID (for orphaned processes)
 */
async function killProcessByPid(
  pid: number,
  serverId: number,
  serverName: string,
): Promise<StopResult> {
  logger.info(
    `[ServerProcess] Killing orphaned process ${pid} for server ${serverId}`,
  );

  return new Promise((resolve) => {
    if (process.platform === "win32") {
      exec(`taskkill /PID ${pid} /T /F`, (error) => {
        if (error) {
          logger.error(`[ServerProcess] Failed to kill PID ${pid}:`, error);
          // Process might already be dead, update status anyway
        }
        updateServerStatus(serverId, "stopped", null);
        broadcast("server:status", {
          serverId,
          status: "stopped",
          pid: null,
          message: `Server ${serverName} stopped`,
        });
        resolve({ success: true, message: `Server ${serverName} stopped` });
      });
    } else {
      try {
        process.kill(pid, "SIGTERM");
        // Give it a moment then force kill if needed
        setTimeout(() => {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // Process already dead
          }
        }, 5000);
      } catch {
        // Process already dead
      }
      updateServerStatus(serverId, "stopped", null);
      broadcast("server:status", {
        serverId,
        status: "stopped",
        pid: null,
        message: `Server ${serverName} stopped`,
      });
      resolve({ success: true, message: `Server ${serverName} stopped` });
    }
  });
}

/**
 * Check if a server is running
 */
export function isServerRunning(serverId: number): boolean {
  return runningProcesses.has(serverId);
}

/**
 * Check server requirements before starting
 * Returns a list of checks with status and helpful messages
 */
export function checkServerRequirements(serverId: number): RequirementsResult {
  const server = getServerById(serverId);
  const checks: RequirementCheck[] = [];

  if (!server) {
    return {
      ready: false,
      checks: [
        { name: "Server", status: "error", message: "Server not found" },
      ],
    };
  }

  const gameDef = getGameDefinition(server.gameId);

  // Check 1: Executable exists
  const executablePath = path.join(server.installPath, server.executable);
  if (fs.existsSync(executablePath)) {
    checks.push({
      name: "Executable",
      status: "ok",
      message: `Server executable found: ${server.executable}`,
    });
  } else {
    checks.push({
      name: "Executable",
      status: "error",
      message: `Server executable not found. Please ensure the server is fully installed.`,
    });
  }

  // Check 2: Config file exists (derived from game definition)
  if (gameDef?.configFiles?.[0]) {
    const configPath = path.join(server.installPath, gameDef.configFiles[0]);
    if (fs.existsSync(configPath)) {
      checks.push({
        name: "Configuration",
        status: "ok",
        message: "Server configuration file found",
      });
    } else {
      checks.push({
        name: "Configuration",
        status: "error",
        message: `${path.basename(gameDef.configFiles[0])} not found. Server may need reinstallation.`,
      });
    }
  }

  // Check 3: Profiles directory (only for games that use it)
  if (gameDef?.capabilities?.profilesPath) {
    const profilesPath = path.join(
      server.installPath,
      server.profilesPath || "profiles",
    );
    if (fs.existsSync(profilesPath)) {
      checks.push({
        name: "Profiles",
        status: "ok",
        message: "Profiles directory exists",
      });
    } else {
      checks.push({
        name: "Profiles",
        status: "warning",
        message: "Profiles directory will be created on first start",
      });
    }
  }

  // Check 4: Windows-specific runtime checks
  if (process.platform === "win32") {
    // Check for DirectX (only possible indirectly via common DLL locations)
    const systemRoot = process.env.SYSTEMROOT || "C:\\Windows";
    const directXDll = path.join(systemRoot, "System32", "XAudio2_7.dll");

    if (fs.existsSync(directXDll)) {
      checks.push({
        name: "DirectX",
        status: "ok",
        message: "DirectX appears to be installed",
      });
    } else {
      checks.push({
        name: "DirectX",
        status: "warning",
        message:
          "DirectX End-User Runtime may be required. If the server crashes immediately, please install it.",
        link: "https://download.microsoft.com/download/1/7/1/1718ccc4-6315-4d8e-9543-8e28a4e18c4c/dxwebsetup.exe",
      });
    }

    // Check for Visual C++ Runtime
    const vcRuntimeDll = path.join(systemRoot, "System32", "vcruntime140.dll");
    if (fs.existsSync(vcRuntimeDll)) {
      checks.push({
        name: "VC++ Runtime",
        status: "ok",
        message: "Visual C++ Runtime is installed",
      });
    } else {
      checks.push({
        name: "VC++ Runtime",
        status: "warning",
        message: "Visual C++ Redistributable may be required.",
        link: "https://aka.ms/vs/17/release/vc_redist.x64.exe",
      });
    }
  }

  // Check 5: BattlEye (only for games using BattlEye RCON)
  if (gameDef?.capabilities.rcon === "battleye") {
    const battleEyePath = path.join(server.installPath, "battleye");
    const beDll = path.join(battleEyePath, "BEServer_x64.dll");
    if (fs.existsSync(beDll)) {
      checks.push({
        name: "BattlEye",
        status: "ok",
        message: "BattlEye anti-cheat is present",
      });
    } else {
      checks.push({
        name: "BattlEye",
        status: "warning",
        message: "BattlEye files not found. Server may not start correctly.",
      });
    }
  }

  // Determine overall readiness
  const hasErrors = checks.some((c) => c.status === "error");

  return {
    ready: !hasErrors,
    checks,
  };
}

/**
 * Get all running server IDs
 */
export function getRunningServerIds(): number[] {
  return Array.from(runningProcesses.keys());
}

/**
 * Restore server states on startup
 * Checks if servers marked as "running" in DB are actually still running
 */
export function restoreServerStates(): void {
  logger.info("[ServerProcess] Checking server states on startup...");

  const servers = getAllServers();

  for (const server of servers) {
    // Reset stale transitional states on startup
    if (
      server.status === "starting" ||
      server.status === "stopping" ||
      server.status === "installing" ||
      server.status === "queued"
    ) {
      logger.info(
        `[ServerProcess] Server ${server.id} (${server.name}) was in "${server.status}" state — resetting to stopped`,
      );
      updateServerStatus(server.id, "stopped", null);
      continue;
    }

    if (server.status === "running" && server.pid) {
      // Check if process is still running
      if (isProcessRunning(server.pid)) {
        logger.info(
          `[ServerProcess] Server ${server.id} (${server.name}) is still running with PID ${server.pid}`,
        );
        // Read RCON config for the still-running server (game-specific)
        const serverGameDef = getGameDefinition(server.gameId);
        const restoredRconConfig = readRconConfig(server, serverGameDef);
        // Start player tracking for the still-running server
        startPlayerTracking(
          server.id,
          server.installPath,
          server.port,
          restoredRconConfig ?? undefined,
        );
      } else {
        logger.info(
          `[ServerProcess] Server ${server.id} (${server.name}) was running but process ${server.pid} is dead`,
        );
        updateServerStatus(server.id, "stopped", null);
      }
    }
  }

  // Auto-start servers that were running before an agent restart/update
  const pendingRaw = getAppSetting("pending_restart_servers");
  if (pendingRaw) {
    // Delete immediately — one-shot, prevents infinite restart loops
    setAppSetting("pending_restart_servers", "");

    try {
      const pendingIds: number[] = JSON.parse(pendingRaw);
      if (pendingIds.length > 0) {
        logger.info(
          `[ServerProcess] Auto-starting ${pendingIds.length} server(s) from previous restart: [${pendingIds.join(", ")}]`,
        );
        for (const id of pendingIds) {
          const server = getServerById(id);
          if (!server) {
            logger.warn(
              `[ServerProcess] Skipping auto-start for server ${id} — not found in database`,
            );
            continue;
          }
          if (server.status !== "stopped") {
            logger.info(
              `[ServerProcess] Skipping auto-start for "${server.name}" — status is "${server.status}"`,
            );
            continue;
          }
          logger.info(
            `[ServerProcess] Auto-starting server ${id} (${server.name})...`,
          );
          const result = startServer(id);
          if (!result.success) {
            logger.error(
              `[ServerProcess] Failed to auto-start "${server.name}": ${result.message}`,
            );
          }
        }
      }
    } catch (err) {
      logger.error(
        "[ServerProcess] Failed to parse pending_restart_servers",
        err,
      );
    }
  }
}

/**
 * Check if a process with given PID is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 tests if process exists without actually sending a signal
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect common dependency errors from error output or exit codes
 * Returns a user-friendly error message with instructions, or null if no known error detected
 */
function detectDependencyError(
  errorOutput: string,
  exitCode: number | null,
): string | null {
  const output = errorOutput.toLowerCase();

  // DirectX errors - common DLLs that indicate missing DirectX
  const directXDlls = [
    "xapofx1_5.dll",
    "xapofx1_4.dll",
    "x3daudio1_7.dll",
    "xinput1_3.dll",
    "d3dx9",
    "d3dx10",
    "d3dx11",
    "d3dcompiler",
  ];

  for (const dll of directXDlls) {
    if (output.includes(dll)) {
      return `[Agent] Missing DirectX component (${dll}). Please install DirectX End-User Runtime on the Agent machine: https://download.microsoft.com/download/1/7/1/1718ccc4-6315-4d8e-9543-8e28a4e18c4c/dxwebsetup.exe - For Windows Server, enable DirectX via Server Manager > Features.`;
    }
  }

  // Generic DLL not found
  if (
    output.includes(".dll") &&
    (output.includes("not found") || output.includes("cannot find"))
  ) {
    const dllMatch = output.match(/([a-z0-9_]+\.dll)/i);
    const dllName = dllMatch ? dllMatch[1] : "unknown DLL";
    return `[Agent] Missing system library: ${dllName}. Install on Agent machine - DirectX: https://download.microsoft.com/download/1/7/1/1718ccc4-6315-4d8e-9543-8e28a4e18c4c/dxwebsetup.exe and VC++ Runtime: https://aka.ms/vs/17/release/vc_redist.x64.exe`;
  }

  // Visual C++ Runtime errors
  const vcRuntimeDlls = [
    "msvcp140.dll",
    "vcruntime140.dll",
    "msvcp120.dll",
    "msvcr120.dll",
    "msvcp110.dll",
    "msvcr110.dll",
  ];

  for (const dll of vcRuntimeDlls) {
    if (output.includes(dll)) {
      return `[Agent] Missing Visual C++ Runtime (${dll}). Please install the latest Visual C++ Redistributable on the Agent machine: https://aka.ms/vs/17/release/vc_redist.x64.exe`;
    }
  }

  // Exit code 0xC0000135 - DLL not found (common Windows error)
  if (exitCode === 0xc0000135 || exitCode === -1073741515) {
    return "[Agent] A required DLL is missing. Please install on the Agent machine - DirectX End-User Runtime: https://download.microsoft.com/download/1/7/1/1718ccc4-6315-4d8e-9543-8e28a4e18c4c/dxwebsetup.exe and Visual C++ Redistributable: https://aka.ms/vs/17/release/vc_redist.x64.exe";
  }

  // Exit code 0xC000007B - Invalid image format (32/64 bit mismatch or corrupted)
  if (exitCode === 0xc000007b || exitCode === -1073741701) {
    return "[Agent] Invalid executable format (64-bit DLL missing). Install on the Agent machine - DirectX: https://download.microsoft.com/download/1/7/1/1718ccc4-6315-4d8e-9543-8e28a4e18c4c/dxwebsetup.exe and VC++ Runtime (x64): https://aka.ms/vs/17/release/vc_redist.x64.exe";
  }

  return null;
}

/**
 * Parse command line arguments respecting quotes
 */
function parseArguments(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = "";
    } else if (char === " " && !inQuotes) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}

/**
 * Gracefully shutdown all running servers (called on app exit)
 */
export async function shutdownAllServers(): Promise<void> {
  logger.info("[ServerProcess] Shutting down all running servers...");

  const serverIds = getRunningServerIds();

  for (const serverId of serverIds) {
    await stopServer(serverId);
  }

  logger.info("[ServerProcess] All servers stopped");
}
