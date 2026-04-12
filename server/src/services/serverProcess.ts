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
import { broadcast } from "../core/broadcast.js";
import { logger } from "../core/logger.js";
import {
  getServerById,
  updateServerStatus,
  updateServerVersion,
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
import {
  startPlayerTracking,
  stopPlayerTracking,
  notifyServerReady,
  getRconConnection,
} from "./playerTracker.js";
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

// Track process exit promises — created at spawn time so stopServer can
// reliably detect process exit regardless of event-loop scheduling.
const processExitPromises: Map<
  number,
  { promise: Promise<void>; resolve: () => void }
> = new Map();

// Track servers currently performing their first start (config not yet generated)
const firstStartServers = new Set<number>();

/** Check whether a server is currently doing its first start (config generation in progress). */
export function isFirstStartInProgress(serverId: number): boolean {
  return firstStartServers.has(serverId);
}

// Track servers being intentionally stopped (to distinguish from crashes)
const stoppingServers = new Set<number>();

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

interface StartResult {
  success: boolean;
  message: string;
  pid?: number;
}

interface StopResult {
  success: boolean;
  message: string;
}

interface RequirementCheck {
  name: string;
  status: "ok" | "warning" | "error";
  message: string;
  link?: string;
}

interface RequirementsResult {
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

  // Capture name for use in closures (avoids TS null-narrowing issues)
  const serverName = server.name;

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

  // Append game-specific additional launch params (e.g. ARK RCON credentials)
  // Insert ?key=value params before -flag params so UE4 parses them correctly
  if (adapter?.getAdditionalLaunchParams) {
    const extra = adapter.getAdditionalLaunchParams(server);
    if (extra) {
      const dashIndex = launchParams.search(/\s+-/);
      if (dashIndex !== -1) {
        launchParams =
          launchParams.slice(0, dashIndex) +
          extra +
          launchParams.slice(dashIndex);
      } else {
        launchParams += extra;
      }
    }
  }

  // Check whether config already exists BEFORE start (for first-start detection)
  const configExistedBeforeStart = adapter?.isConfigGenerated?.(server) ?? true;

  // Track first-start servers so the config-status endpoint can suppress premature
  // configGenerated responses while the game is still initialising.
  if (!configExistedBeforeStart) {
    firstStartServers.add(serverId);
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

    // Create exit promise at spawn time — resolved from the exit handler below.
    // This guarantees stopServer can detect exit even if the process dies during RCON commands.
    let resolveExit!: () => void;
    const exitPromise = new Promise<void>((r) => {
      resolveExit = r;
    });
    processExitPromises.set(serverId, {
      promise: exitPromise,
      resolve: resolveExit,
    });

    // Record PID and start timestamp but keep status as "starting" until
    // the game-specific startup detector fires (or the timeout expires).
    const startedAt = new Date().toISOString();
    updateServerStatus(serverId, "starting", child.pid, startedAt);

    // Broadcast status update (still starting — PID is known)
    broadcast("server:status", {
      serverId,
      status: "starting",
      pid: child.pid,
      message: `Server ${server.name} is starting...`,
    });

    // Start player tracking (RCON polling + log backfill)
    startPlayerTracking(
      serverId,
      server.installPath,
      server.port,
      rconConfig || undefined,
    );

    // Capture stdout/stderr to a log file for the LogsTab (created lazily on first write)
    let consoleLogStream: fs.WriteStream | null = null;
    let consoleLogPath: string | null = null;
    if (logPaths && logPaths.directories.length > 0) {
      const consoleLogDir = logPaths.directories[0];
      if (!fs.existsSync(consoleLogDir)) {
        fs.mkdirSync(consoleLogDir, { recursive: true });
      }
      consoleLogPath = path.join(consoleLogDir, "console-output.log");
    }

    function writeConsoleLog(data: string): void {
      if (!consoleLogPath) return;
      if (!consoleLogStream) {
        consoleLogStream = fs.createWriteStream(consoleLogPath, { flags: "w" });
        consoleLogStream.on("error", (err) => {
          logger.error(
            `[ServerProcess] Console log write error: ${err.message}`,
          );
          consoleLogStream = null;
        });
      }
      consoleLogStream.write(data);
    }

    // Collect stderr output for error reporting
    let lastStderrOutput = "";

    // Handle stdout
    let startupDetected = false;
    const detector = adapter?.getStartupDetector(server) ?? null;
    const startupPattern = detector ? new RegExp(detector.pattern) : null;

    child.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      logger.debug(`[Server ${serverId}] ${output}`);
      writeConsoleLog(output);
      broadcast("server:output", {
        serverId,
        type: "stdout",
        message: output,
      });

      // Detect startup completion from stdout
      if (
        !startupDetected &&
        startupPattern &&
        detector?.type === "stdout" &&
        startupPattern.test(output)
      ) {
        onStartupComplete();
      }
    });

    // Detect startup completion from game log file
    let logWatchInterval: ReturnType<typeof setInterval> | null = null;
    let lastLogSize = 0;

    function onStartupComplete(): void {
      // Guard against double-invocation (pattern match + timeout race)
      if (startupDetected) return;
      startupDetected = true;

      logger.info(
        `[ServerProcess] Startup complete detected for server ${serverId}`,
      );

      // First start is complete — remove from tracking
      firstStartServers.delete(serverId);

      // Stop log file watcher
      if (logWatchInterval) {
        clearInterval(logWatchInterval);
        logWatchInterval = null;
      }

      // Transition status from "starting" → "running"
      updateServerStatus(serverId, "running", child.pid ?? null, startedAt);
      broadcast("server:status", {
        serverId,
        status: "running",
        pid: child.pid ?? null,
        message: `Server ${serverName} started`,
      });

      // Activate scheduled restart, RCON messages, and update checker
      // (deferred until actual startup so timers start from ready time)
      startSchedule(serverId);
      startMessageBroadcaster(serverId);
      startUpdateChecker(serverId);

      // Extract game version from log files and persist to DB
      if (adapter) {
        try {
          const version = adapter.getServerVersion?.(server!);
          if (version) {
            updateServerVersion(serverId, version);
            logger.info(
              `[ServerProcess] Detected game version ${version} for server ${serverId}`,
            );
          }
        } catch (err) {
          logger.error(
            `[ServerProcess] Failed to extract game version: ${err}`,
          );
        }
      }

      // Re-validate adapter config after start (game may have overwritten config files)
      if (adapter) {
        const freshServer = getServerById(serverId);
        if (freshServer) {
          adapter.validatePreStart(freshServer);

          // First-start config handling: if config didn't exist before start
          // but the game has now generated it, write initial settings into the
          // generated config and notify clients
          if (
            !configExistedBeforeStart &&
            adapter.isConfigGenerated?.(freshServer)
          ) {
            logger.info(
              `[ServerProcess] First-start config detected for server ${serverId}, writing initial settings`,
            );
            try {
              adapter.writeInitialSettingsToConfig?.(freshServer);
              broadcast("server:config-ready", { serverId });
            } catch (err) {
              logger.error(
                `[ServerProcess] Failed to write initial settings: ${err}`,
              );
            }
          }
        }
      }

      notifyServerReady(serverId);
    }

    /**
     * Resolve a logFile spec to an absolute path.
     * Supports glob wildcards (`*`) — returns the most recently modified match.
     */
    function resolveLogFilePath(logFileSpec: string): string | null {
      if (!logFileSpec.includes("*")) {
        return path.join(server!.installPath, logFileSpec);
      }
      const dir = path.dirname(path.join(server!.installPath, logFileSpec));
      const baseName = path.basename(logFileSpec);
      const globRegex = new RegExp(
        "^" + baseName.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
      );
      try {
        if (!fs.existsSync(dir)) return null;
        const matches = fs
          .readdirSync(dir)
          .filter((f) => globRegex.test(f))
          .map((f) => {
            const full = path.join(dir, f);
            try {
              return { path: full, mtime: fs.statSync(full).mtimeMs };
            } catch {
              return null;
            }
          })
          .filter(Boolean) as { path: string; mtime: number }[];
        if (matches.length === 0) return null;
        matches.sort((a, b) => b.mtime - a.mtime);
        return matches[0].path;
      } catch {
        return null;
      }
    }

    if (startupPattern && detector?.type === "logfile" && detector.logFile) {
      let resolvedLogPath: string | null = null;

      // For non-glob paths, initialize to current file size so we only read NEW content
      if (!detector.logFile.includes("*")) {
        resolvedLogPath = resolveLogFilePath(detector.logFile);
        try {
          if (resolvedLogPath && fs.existsSync(resolvedLogPath)) {
            lastLogSize = fs.statSync(resolvedLogPath).size;
          }
        } catch {
          // File doesn't exist yet — will be created by the game server
        }
      }

      // Poll the log file every 3 seconds for the startup pattern
      logWatchInterval = setInterval(() => {
        if (startupDetected) {
          if (logWatchInterval) clearInterval(logWatchInterval);
          return;
        }
        try {
          // Re-resolve glob patterns each iteration (file may appear mid-startup)
          const currentPath = resolveLogFilePath(detector!.logFile!);
          if (!currentPath || !fs.existsSync(currentPath)) return;

          // If the resolved file changed (e.g. new timestamped log), reset position
          if (currentPath !== resolvedLogPath) {
            resolvedLogPath = currentPath;
            lastLogSize = 0;
          }

          const stat = fs.statSync(currentPath);
          // If file was truncated/recreated, reset position
          if (stat.size < lastLogSize) {
            lastLogSize = 0;
          }
          if (stat.size <= lastLogSize) return;

          // Read only the new portion of the file
          const fd = fs.openSync(currentPath, "r");
          const newBytes = stat.size - lastLogSize;
          const buf = Buffer.alloc(newBytes);
          fs.readSync(fd, buf, 0, newBytes, lastLogSize);
          fs.closeSync(fd);
          lastLogSize = stat.size;

          const newContent = buf.toString("utf-8");
          if (startupPattern.test(newContent)) {
            onStartupComplete();
          }
        } catch {
          // File may not exist yet or be locked — retry next interval
        }
      }, 3000);
    }

    // Startup timeout — applies to ALL detector types (stdout, logfile) and null fallback.
    // Ensures the server always transitions from "starting" → "running".
    const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
    const startupTimeoutMs = detector?.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    setTimeout(() => {
      if (!startupDetected) {
        logger.warn(
          `[ServerProcess] Startup detection timed out after ${startupTimeoutMs / 1000}s for server ${serverId}, marking as running`,
        );
        onStartupComplete();
      }
    }, startupTimeoutMs);

    // Handle stderr
    child.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();
      logger.error(`[Server ${serverId}] STDERR: ${output}`);
      // Keep last stderr output for crash reporting
      lastStderrOutput = output;
      writeConsoleLog(output);
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

      // Clean up first-start tracking
      firstStartServers.delete(serverId);

      // Stop log file watcher if still active
      if (logWatchInterval) {
        clearInterval(logWatchInterval);
        logWatchInterval = null;
      }

      logger.info(
        `[ServerProcess] Server ${serverId} exited with code ${code}, signal ${signal}`,
      );
      if (lastStderrOutput) {
        logger.error(`[ServerProcess] Last stderr: ${lastStderrOutput}`);
      }

      // Remove from tracking
      runningProcesses.delete(serverId);

      // Resolve the exit promise so stopServer detects exit immediately
      const exitEntry = processExitPromises.get(serverId);
      if (exitEntry) {
        exitEntry.resolve();
        processExitPromises.delete(serverId);
      }

      // Stop player tracking
      stopPlayerTracking(serverId);

      // Clear scheduled restart timers
      clearSchedule(serverId);

      // Clear scheduled message timers
      stopMessageBroadcaster(serverId);

      // Stop update checker
      stopUpdateChecker(serverId);

      // Determine if this was expected (graceful stop) or a crash
      const wasExpected =
        stoppingServers.has(serverId) || signal === "SIGTERM" || code === 0;
      stoppingServers.delete(serverId);
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

    // NOTE: startSchedule, startMessageBroadcaster, and startUpdateChecker
    // are now called inside onStartupComplete() so that timers start from the
    // actual server-ready time rather than from process spawn.

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
 *
 * Shutdown sequence:
 * 1. Send RCON shutdown commands (game-specific graceful shutdown)
 * 2. Race RCON commands against the process exit promise (created at spawn time)
 * 3. Wait for process exit with timeout
 * 4. Force-kill as last resort if process doesn't exit
 *
 * The exit promise is created in startServer at spawn time and resolved from
 * the startServer exit handler, which is proven to fire reliably. This avoids
 * event-loop scheduling issues with listeners registered during async operations.
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

  // Mark as intentionally stopping so the exit handler knows this isn't a crash
  stoppingServers.add(serverId);

  // Set stopping status immediately
  updateServerStatus(serverId, "stopping", server.pid);
  broadcast("server:status", {
    serverId,
    status: "stopping",
    pid: server.pid,
    message: `Server ${server.name} is stopping...`,
  });

  // Get the exit promise created at spawn time — guaranteed to resolve when
  // the startServer exit handler runs (which the logs confirm fires reliably).
  const exitEntry = processExitPromises.get(serverId);
  const exitPromise =
    exitEntry?.promise ??
    new Promise<void>((resolve) => {
      // Fallback: register listener directly if no spawn-time promise exists
      // (e.g. for processes restored after restart)
      child.once("exit", resolve);
    });

  // Helper: check if the process has already exited
  const hasExited = () => !runningProcesses.has(serverId);

  // Attempt RCON graceful shutdown before resorting to process termination
  let rconShutdownSent = false;
  const adapter = getGameAdapter(server.gameId);
  const shutdownConfig = adapter?.getShutdownCommands();

  if (shutdownConfig) {
    const rcon = getRconConnection(serverId);
    if (rcon?.isConnected()) {
      try {
        for (let i = 0; i < shutdownConfig.commands.length; i++) {
          // If process already exited during earlier commands, stop sending more
          if (hasExited()) {
            logger.info(
              `[ServerProcess] Server ${serverId} already exited during RCON shutdown sequence`,
            );
            break;
          }

          const cmd = shutdownConfig.commands[i];
          logger.info(`[ServerProcess] Sending RCON shutdown command: ${cmd}`);

          // Race each RCON command against the exit promise so we don't
          // block on a command that will never return (server already dead).
          const rconResult = await Promise.race([
            rcon.sendCommand(cmd).then(() => "sent" as const),
            exitPromise.then(() => "exited" as const),
          ]);

          if (rconResult === "exited") {
            logger.info(
              `[ServerProcess] Server ${serverId} exited while sending RCON command: ${cmd}`,
            );
            break;
          }

          // Delay between commands (e.g. saveworld → doexit)
          if (
            shutdownConfig.delayBetweenMs &&
            i < shutdownConfig.commands.length - 1
          ) {
            // Also race delay against exit
            const delayResult = await Promise.race([
              new Promise<"delayed">((r) =>
                setTimeout(() => r("delayed"), shutdownConfig.delayBetweenMs),
              ),
              exitPromise.then(() => "exited" as const),
            ]);
            if (delayResult === "exited") {
              logger.info(
                `[ServerProcess] Server ${serverId} exited during shutdown delay`,
              );
              break;
            }
          }
        }
        if (!hasExited()) {
          rconShutdownSent = true;
          logger.info(
            `[ServerProcess] RCON shutdown commands sent for server ${serverId}`,
          );
        }
      } catch (error) {
        // RCON errors during shutdown are expected (connection closes when server exits)
        if (!hasExited()) {
          logger.warn(
            `[ServerProcess] RCON shutdown failed for server ${serverId}, will force-kill:`,
            (error as Error).message,
          );
        }
      }
    } else {
      logger.warn(
        `[ServerProcess] No active RCON connection for server ${serverId}, will force-kill`,
      );
    }
  }

  // If process already exited during RCON commands, we're done
  if (hasExited()) {
    logger.info(
      `[ServerProcess] Server ${serverId} exited during shutdown sequence`,
    );
    return { success: true, message: `Server ${server.name} stopped` };
  }

  // If RCON shutdown was not sent, force-kill the process immediately
  if (!rconShutdownSent) {
    if (process.platform === "win32") {
      exec(`taskkill /PID ${child.pid} /T /F`, (error) => {
        if (error) {
          logger.error(`[ServerProcess] taskkill error:`, error);
        }
      });
    } else {
      child.kill("SIGTERM");
    }
  }

  // Wait for process exit with a timeout
  const GRACEFUL_TIMEOUT_MS = rconShutdownSent ? 60000 : 5000;

  const timeoutPromise = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), GRACEFUL_TIMEOUT_MS),
  );

  const result = await Promise.race([
    exitPromise.then(() => "exited" as const),
    timeoutPromise,
  ]);

  if (result === "timeout") {
    logger.warn(
      `[ServerProcess] Force killing server ${serverId} (graceful shutdown timed out after ${GRACEFUL_TIMEOUT_MS / 1000}s)`,
    );
    if (process.platform === "win32") {
      exec(`taskkill /PID ${child.pid} /T /F`, (error) => {
        if (error) {
          logger.error(`[ServerProcess] Force kill error:`, error);
        }
      });
    } else {
      child.kill("SIGKILL");
    }

    // Wait for actual exit after force kill
    await exitPromise;
  }

  return { success: true, message: `Server ${server.name} stopped` };
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
    // Resume interrupted deletions
    if (server.status === "deleting") {
      logger.info(
        `[ServerProcess] Server ${server.id} (${server.name}) was in "deleting" state — resuming deletion`,
      );
      import("./serverDelete.js").then(({ performBackgroundDeletion }) =>
        performBackgroundDeletion(
          server.id,
          server.name,
          server.gameId,
          server.port,
          server.installPath,
        ),
      );
      continue;
    }

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
          true, // alreadyRunning — skip startup pattern wait
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
