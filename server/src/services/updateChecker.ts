/**
 * Update Checker Service
 *
 * Periodically checks for mod and game server updates.
 * - Mod updates: via Steam Workshop HTTP API (time_updated comparison)
 * - Game server updates: via SteamCMD app_info_print (buildid comparison)
 * When updates are detected:
 * - Marks mods as "update_available" in DB
 * - Broadcasts update:detected via WebSocket
 * - If auto-restart on update is enabled, starts a countdown with RCON warnings
 * - After countdown: stops server, reinstalls updated mods / updates game, restarts server
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { broadcast, logger } from "../index.js";
import {
  getUpdateRestartSettings,
  getServerById,
  setModUpdateAvailable,
  getSteamConfig,
} from "../db/index.js";
import { checkModsForUpdates, installMod } from "./modManager.js";
import { stopServer, startServer, isServerRunning } from "./serverProcess.js";
import { getRconConnection } from "./playerTracker.js";
import { resolveVariables } from "./variableResolver.js";
import { getGameDefinition } from "../games/index.js";
import { getConfig, getSteamCMDExecutable } from "./config.js";
import { updateServer } from "./serverInstall.js";

// Active check intervals per server
const checkIntervals = new Map<number, ReturnType<typeof setInterval>>();

// Active update restart timers per server
const updateRestartTimers = new Map<number, ReturnType<typeof setTimeout>>();
const updateWarningTimers = new Map<number, ReturnType<typeof setTimeout>[]>();

// Track which servers have a pending update restart to avoid duplicate triggers
const pendingUpdateRestarts = new Set<number>();

// ─── Game Server Build-ID Helpers ───────────────────────────────────────

/**
 * Read the locally installed build ID from the appmanifest file.
 * Returns null if the manifest cannot be read.
 */
function getLocalBuildId(installPath: string, appId: number): string | null {
  const manifestPath = path.join(
    installPath,
    "steamapps",
    `appmanifest_${appId}.acf`,
  );

  try {
    if (!fs.existsSync(manifestPath)) return null;
    const content = fs.readFileSync(manifestPath, "utf-8");
    const match = content.match(/"buildid"\s+"(\d+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Query SteamCMD for the latest available build ID of an app.
 * Runs: steamcmd +login anonymous +app_info_update 1 +app_info_print <appId> +quit
 * Polls console_log.txt and broadcasts output via WebSocket (same pattern as login/install).
 * Parses the output for the "buildid" field under the "public" branch.
 */
function getLatestBuildId(
  appId: number,
  useLogin: boolean,
  serverId?: number,
): Promise<{ buildId: string | null; output: string }> {
  return new Promise((resolve) => {
    const executable = getSteamCMDExecutable();
    if (!fs.existsSync(executable)) {
      logger.warn("[UpdateChecker] SteamCMD executable not found");
      resolve({ buildId: null, output: "SteamCMD executable not found" });
      return;
    }

    const loginArg = useLogin
      ? (() => {
          const steamConfig = getSteamConfig();
          return steamConfig?.username && steamConfig.isLoggedIn
            ? steamConfig.username
            : "anonymous";
        })()
      : "anonymous";

    const args = [
      "+login",
      loginArg,
      "+app_info_update",
      "1",
      "+app_info_print",
      appId.toString(),
      "+quit",
    ];

    // ── Log-file polling (source of truth for output, same as login/install) ──
    const config = getConfig();
    const logFile = path.join(config.steamcmdPath, "logs", "console_log.txt");
    let lastLogSize = 0;
    let logPollInterval: ReturnType<typeof setInterval> | null = null;
    let accumulatedLogOutput = "";
    let credentialsNotFound = false;

    // Record initial log file size so we only read new content
    try {
      if (fs.existsSync(logFile)) {
        lastLogSize = fs.statSync(logFile).size;
      }
    } catch {
      // Ignore
    }

    const cleanupPoll = () => {
      if (logPollInterval) {
        clearInterval(logPollInterval);
        logPollInterval = null;
      }
    };

    /**
     * Read new content appended to console_log.txt since last check.
     * Broadcasts cleaned lines to client via WebSocket.
     */
    const readNewLogContent = () => {
      try {
        if (!fs.existsSync(logFile)) return;
        const stat = fs.statSync(logFile);
        if (stat.size <= lastLogSize) return;

        const fd = fs.openSync(logFile, "r");
        const buffer = Buffer.alloc(stat.size - lastLogSize);
        fs.readSync(fd, buffer, 0, buffer.length, lastLogSize);
        fs.closeSync(fd);
        lastLogSize = stat.size;

        const newContent = buffer.toString("utf-8");
        accumulatedLogOutput += newContent;

        // Strip timestamps and broadcast clean lines
        const lines = newContent
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .split("\n")
          .map((l) =>
            l
              .replace(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]\s*/, "")
              .trimEnd(),
          )
          .filter((l) => l.length > 0);

        for (const line of lines) {
          broadcast("steamcmd:output", {
            message: line,
            serverId,
            context: "update-check",
          });
        }

        // Detect "Cached credentials not found" — kill process immediately
        // so the user can log in without the old process blocking SteamCMD
        const lower = accumulatedLogOutput.toLowerCase();
        if (
          !credentialsNotFound &&
          (lower.includes("cached credentials not found") ||
            lower.includes("password:"))
        ) {
          credentialsNotFound = true;
          logger.info(
            `[UpdateChecker] Credentials not found for app ${appId} — killing SteamCMD process`,
          );
          proc.kill();
        }
      } catch {
        // Ignore read errors
      }
    };

    // Poll the log file every 300ms
    logPollInterval = setInterval(readNewLogContent, 300);

    const proc = spawn(executable, args, {
      cwd: path.dirname(executable),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";
    const timeout = setTimeout(() => {
      proc.kill();
      cleanupPoll();
      // Do a final read
      readNewLogContent();
      logger.warn(
        `[UpdateChecker] SteamCMD timed out checking build ID for app ${appId}`,
      );
      resolve({ buildId: null, output: output + "\n[Timed out after 60s]" });
    }, 60000); // 60 second timeout

    proc.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.on("close", () => {
      clearTimeout(timeout);
      cleanupPoll();
      // Do a final read to capture any remaining log content
      readNewLogContent();

      // Parse the app_info_print output to find the build ID under "public" branch.
      const publicBranchMatch = output.match(
        /"public"\s*\{[^}]*"buildid"\s+"(\d+)"/,
      );
      if (publicBranchMatch) {
        resolve({ buildId: publicBranchMatch[1], output });
      } else {
        // Fallback: try to find any buildid in the output
        const fallbackMatch = output.match(/"buildid"\s+"(\d+)"/);
        resolve({ buildId: fallbackMatch ? fallbackMatch[1] : null, output });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      cleanupPoll();
      logger.error(`[UpdateChecker] SteamCMD error checking build ID:`, err);
      resolve({ buildId: null, output: output + `\n[Error: ${err.message}]` });
    });
  });
}

interface GameUpdateCheckResult {
  localBuildId: string;
  latestBuildId: string;
  steamcmdOutput: string;
}

/**
 * Check if a game server has an update available by comparing build IDs.
 * Returns the new build ID if an update is available, null otherwise.
 * If requiresLogin and no user is logged in, returns a loginRequired flag.
 */
async function checkGameServerUpdate(serverId: number): Promise<{
  result: GameUpdateCheckResult | null;
  steamcmdOutput: string;
  loginRequired: boolean;
}> {
  const server = getServerById(serverId);
  if (!server)
    return { result: null, steamcmdOutput: "", loginRequired: false };

  const gameDef = getGameDefinition(server.gameId);
  if (!gameDef)
    return { result: null, steamcmdOutput: "", loginRequired: false };

  // Check if login is required but user isn't logged in
  if (gameDef.requiresLogin) {
    const steamConfig = getSteamConfig();
    if (!steamConfig?.username || !steamConfig.isLoggedIn) {
      logger.warn(
        `[UpdateChecker] Server ${serverId}: game update check skipped - Steam login required but no user logged in`,
      );
      return {
        result: null,
        steamcmdOutput:
          "Steam login required for game update check. Please log in via Dashboard.",
        loginRequired: true,
      };
    }
  }

  const localBuildId = getLocalBuildId(server.installPath, server.appId);
  if (!localBuildId) {
    logger.warn(
      `[UpdateChecker] Server ${serverId}: could not read local build ID`,
    );
    return { result: null, steamcmdOutput: "", loginRequired: false };
  }

  const { buildId: latestBuildId, output: steamcmdOutput } =
    await getLatestBuildId(server.appId, gameDef.requiresLogin, serverId);
  if (!latestBuildId) {
    logger.warn(
      `[UpdateChecker] Server ${serverId}: could not fetch latest build ID`,
    );
    return { result: null, steamcmdOutput, loginRequired: false };
  }

  if (localBuildId !== latestBuildId) {
    logger.info(
      `[UpdateChecker] Server ${serverId}: game update available (local: ${localBuildId}, latest: ${latestBuildId})`,
    );
    return {
      result: { localBuildId, latestBuildId, steamcmdOutput },
      steamcmdOutput,
      loginRequired: false,
    };
  }

  return { result: null, steamcmdOutput, loginRequired: false };
}

// ─── Update Result Type ─────────────────────────────────────────────────

interface UpdateCheckResult {
  updatedMods: { modId: number; workshopId: string; name: string }[];
  gameUpdateAvailable: boolean;
  latestBuildId?: string;
  steamcmdOutput?: string;
  loginRequired?: boolean;
}

/**
 * Start the update checker for a server
 */
export function startUpdateChecker(serverId: number): void {
  stopUpdateChecker(serverId);

  const settings = getUpdateRestartSettings(serverId);
  if (!settings.enabled) {
    return;
  }

  const intervalMs = settings.checkIntervalMinutes * 60 * 1000;

  logger.info(
    `[UpdateChecker] Server ${serverId}: starting update checks every ${settings.checkIntervalMinutes} minutes`,
  );

  // Run first check after a short delay (30 seconds) to let server fully start
  const initialTimer = setTimeout(() => {
    performUpdateCheck(serverId);
  }, 30000);

  // Store the initial timer so it can be cleared
  updateWarningTimers.set(serverId, [initialTimer]);

  // Set up recurring checks
  const interval = setInterval(() => {
    performUpdateCheck(serverId);
  }, intervalMs);

  checkIntervals.set(serverId, interval);
}

/**
 * Stop the update checker for a server
 */
export function stopUpdateChecker(serverId: number): void {
  const interval = checkIntervals.get(serverId);
  if (interval) {
    clearInterval(interval);
    checkIntervals.delete(serverId);
  }

  cancelUpdateRestart(serverId);
}

/**
 * Cancel a pending update restart (warnings + restart timer)
 */
function cancelUpdateRestart(serverId: number): void {
  const restartTimer = updateRestartTimers.get(serverId);
  if (restartTimer) {
    clearTimeout(restartTimer);
    updateRestartTimers.delete(serverId);
  }

  const warnings = updateWarningTimers.get(serverId);
  if (warnings) {
    for (const timer of warnings) {
      clearTimeout(timer);
    }
    updateWarningTimers.delete(serverId);
  }

  pendingUpdateRestarts.delete(serverId);
}

/**
 * Perform a single update check for a server (mods + game server)
 */
async function performUpdateCheck(serverId: number): Promise<void> {
  // Don't check if server is not running
  if (!isServerRunning(serverId)) return;

  // Don't check if there's already a pending update restart
  if (pendingUpdateRestarts.has(serverId)) return;

  const settings = getUpdateRestartSettings(serverId);

  try {
    const result: UpdateCheckResult = {
      updatedMods: [],
      gameUpdateAvailable: false,
    };

    // Check mod updates
    const updatedMods = await checkModsForUpdates(serverId);
    if (updatedMods.length > 0) {
      result.updatedMods = updatedMods;

      logger.info(
        `[UpdateChecker] Server ${serverId}: ${updatedMods.length} mod update(s) detected:`,
        updatedMods.map((m) => m.name).join(", "),
      );

      // Mark mods as update_available in DB
      for (const mod of updatedMods) {
        setModUpdateAvailable(mod.modId);
      }
    }

    // Check game server update
    if (settings.checkGameUpdates) {
      const { result: gameUpdate } = await checkGameServerUpdate(serverId);
      if (gameUpdate) {
        result.gameUpdateAvailable = true;
        result.latestBuildId = gameUpdate.latestBuildId;
      }
    }

    // Nothing to update
    if (result.updatedMods.length === 0 && !result.gameUpdateAvailable) return;

    // Build broadcast message
    const parts: string[] = [];
    if (result.updatedMods.length > 0) {
      parts.push(`${result.updatedMods.length} mod update(s)`);
    }
    if (result.gameUpdateAvailable) {
      parts.push(`game server update (build ${result.latestBuildId})`);
    }
    const message = `Updates available: ${parts.join(", ")}`;

    // Broadcast to UI
    broadcast("update:detected", {
      serverId,
      mods: result.updatedMods,
      gameUpdateAvailable: result.gameUpdateAvailable,
      latestBuildId: result.latestBuildId,
      message,
    });

    // Start countdown if auto-restart is enabled
    if (settings.enabled) {
      startUpdateRestartCountdown(serverId, result);
    }
  } catch (error) {
    logger.error(
      `[UpdateChecker] Server ${serverId}: error checking for updates:`,
      error,
    );
  }
}

/**
 * Start the countdown for an update restart with RCON warnings
 */
function startUpdateRestartCountdown(
  serverId: number,
  updateResult: UpdateCheckResult,
): void {
  if (pendingUpdateRestarts.has(serverId)) return;
  pendingUpdateRestarts.add(serverId);

  const settings = getUpdateRestartSettings(serverId);
  const delayMs = settings.delayMinutes * 60 * 1000;

  // Prepare mod context variables for warning messages
  const modNames = updateResult.updatedMods.map((m) => m.name).join(", ");
  const firstModName = updateResult.updatedMods[0]?.name || "Unknown";
  const smartModName =
    updateResult.updatedMods.length === 0 && updateResult.gameUpdateAvailable
      ? "Game Server"
      : updateResult.updatedMods.length <= 3
        ? modNames
        : `${firstModName} and ${updateResult.updatedMods.length - 1} others`;

  const modContext = {
    MOD_NAME: smartModName,
    MOD_COUNT: updateResult.updatedMods.length.toString(),
    MOD_NAMES: modNames || "None",
  };

  const reason = updateResult.gameUpdateAvailable
    ? "game & mod updates"
    : "mod updates";
  logger.info(
    `[UpdateChecker] Server ${serverId}: starting update restart countdown (${settings.delayMinutes} minutes) for ${reason}`,
  );

  // Broadcast that restart is pending
  broadcast("update:restart", {
    serverId,
    delayMinutes: settings.delayMinutes,
    mods: updateResult.updatedMods,
    gameUpdateAvailable: updateResult.gameUpdateAvailable,
    message: `Server will restart in ${settings.delayMinutes} minutes for ${reason}`,
  });

  // Schedule warning messages
  const warningTimers: ReturnType<typeof setTimeout>[] = [];
  const sortedWarnings = [...settings.warningMinutes].sort((a, b) => b - a);

  for (const minutes of sortedWarnings) {
    const msBeforeRestart = minutes * 60 * 1000;
    const msUntilWarning = delayMs - msBeforeRestart;

    if (msUntilWarning > 0) {
      const timer = setTimeout(() => {
        sendUpdateWarning(
          serverId,
          settings.warningMessage,
          minutes,
          modContext,
        );
      }, msUntilWarning);
      warningTimers.push(timer);
    } else if (msUntilWarning === 0) {
      // Send immediately
      sendUpdateWarning(serverId, settings.warningMessage, minutes, modContext);
    }
  }

  updateWarningTimers.set(serverId, warningTimers);

  // Schedule the actual restart
  const restartTimer = setTimeout(() => {
    performUpdateRestart(serverId, updateResult);
  }, delayMs);

  updateRestartTimers.set(serverId, restartTimer);
}

/**
 * Send an in-game warning about upcoming update restart via RCON
 */
async function sendUpdateWarning(
  serverId: number,
  messageTemplate: string,
  minutes: number,
  extraVars?: Record<string, string>,
): Promise<void> {
  const message = resolveVariables(serverId, messageTemplate, {
    MINUTES: minutes.toString(),
    ...extraVars,
  });

  logger.info(
    `[UpdateChecker] Server ${serverId}: sending update warning - "${message}"`,
  );

  // Send via RCON
  const rcon = getRconConnection(serverId);
  if (rcon && rcon.isConnected()) {
    try {
      await rcon.broadcastMessage(message);
    } catch (err) {
      logger.error(
        `[UpdateChecker] Server ${serverId}: failed to send RCON warning:`,
        err,
      );
    }
  } else {
    logger.warn(
      `[UpdateChecker] Server ${serverId}: RCON not connected, cannot send update warning`,
    );
  }

  // Broadcast warning to UI
  broadcast("update:warning", {
    serverId,
    minutes,
    message,
  });
}

/**
 * Perform the update restart: stop server, update game/mods, start server
 */
async function performUpdateRestart(
  serverId: number,
  updateResult: UpdateCheckResult,
): Promise<void> {
  const server = getServerById(serverId);
  if (!server) {
    logger.error(
      `[UpdateChecker] Server ${serverId} not found, skipping update restart`,
    );
    pendingUpdateRestarts.delete(serverId);
    return;
  }

  const gameDef = getGameDefinition(server.gameId);
  const { updatedMods, gameUpdateAvailable } = updateResult;

  const reason = gameUpdateAvailable
    ? `game update + ${updatedMods.length} mod(s)`
    : `${updatedMods.length} mod(s)`;
  logger.info(
    `[UpdateChecker] Server ${serverId}: performing update restart for ${reason}`,
  );

  // Broadcast restart event
  broadcast("update:restart", {
    serverId,
    message: `Restarting ${server.name} for updates`,
    mods: updatedMods,
    gameUpdateAvailable,
  });

  // Stop the server
  if (isServerRunning(serverId)) {
    const stopResult = await stopServer(serverId);
    if (!stopResult.success) {
      logger.error(
        `[UpdateChecker] Failed to stop server ${serverId}:`,
        stopResult.message,
      );
      pendingUpdateRestarts.delete(serverId);
      return;
    }

    // Wait for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Update game server if needed
  if (gameUpdateAvailable) {
    logger.info(
      `[UpdateChecker] Server ${serverId}: updating game server (app ${server.appId})`,
    );

    broadcast("update:applied", {
      serverId,
      message: `Updating game server...`,
      gameUpdateAvailable: true,
      mods: updatedMods,
    });

    const useAnonymous = gameDef ? !gameDef.requiresLogin : true;
    try {
      // Pass username from DB for authenticated updates
      const steamConfig = getSteamConfig();
      const updateResult = await updateServer(
        serverId,
        server.gameId,
        server.appId,
        server.installPath,
        server.name,
        server.port,
        useAnonymous,
        steamConfig?.username,
      );

      if (!updateResult.success) {
        logger.error(
          `[UpdateChecker] Game server update failed:`,
          updateResult.message,
        );
      } else {
        logger.info(
          `[UpdateChecker] Game server update completed successfully`,
        );
      }
    } catch (error) {
      logger.error(`[UpdateChecker] Game server update error:`, error);
    }

    // Wait after game update
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  // Reinstall updated mods
  if (updatedMods.length > 0) {
    logger.info(
      `[UpdateChecker] Server ${serverId}: reinstalling ${updatedMods.length} updated mod(s)`,
    );

    broadcast("update:applied", {
      serverId,
      message: `Installing ${updatedMods.length} mod update(s)...`,
      mods: updatedMods,
    });

    for (const mod of updatedMods) {
      try {
        logger.info(
          `[UpdateChecker] Reinstalling mod ${mod.workshopId} (${mod.name})`,
        );
        await installMod(mod.modId);
      } catch (error) {
        logger.error(
          `[UpdateChecker] Failed to reinstall mod ${mod.workshopId}:`,
          error,
        );
      }
    }

    // Wait a bit after mod installations
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  // Start the server again
  logger.info(
    `[UpdateChecker] Server ${serverId}: starting server after updates`,
  );
  const startResult = startServer(serverId);
  if (!startResult.success) {
    logger.error(
      `[UpdateChecker] Failed to start server ${serverId}:`,
      startResult.message,
    );
  }

  pendingUpdateRestarts.delete(serverId);
}

/**
 * Manually trigger an update check for a server (mods + game)
 */
export async function triggerUpdateCheck(
  serverId: number,
): Promise<UpdateCheckResult> {
  const result: UpdateCheckResult = {
    updatedMods: [],
    gameUpdateAvailable: false,
  };

  // Broadcast initial status
  broadcast("steamcmd:output", {
    message: "Checking for mod updates via Steam Workshop API...",
    serverId,
    context: "update-check",
  });

  // Check mod updates
  const updatedMods = await checkModsForUpdates(serverId);
  if (updatedMods.length > 0) {
    result.updatedMods = updatedMods;

    // Mark mods as update_available
    for (const mod of updatedMods) {
      setModUpdateAvailable(mod.modId);
    }
    broadcast("steamcmd:output", {
      message: `Found ${updatedMods.length} mod update(s): ${updatedMods.map((m) => m.name).join(", ")}`,
      serverId,
      context: "update-check",
    });
  } else {
    broadcast("steamcmd:output", {
      message: "All mods are up to date.",
      serverId,
      context: "update-check",
    });
  }

  // Check game server update
  const settings = getUpdateRestartSettings(serverId);
  if (settings.checkGameUpdates) {
    broadcast("steamcmd:output", {
      message: "Checking for game server updates via SteamCMD...",
      serverId,
      context: "update-check",
    });

    const {
      result: gameUpdate,
      steamcmdOutput,
      loginRequired,
    } = await checkGameServerUpdate(serverId);
    result.steamcmdOutput = steamcmdOutput;
    result.loginRequired = loginRequired;
    if (gameUpdate) {
      result.gameUpdateAvailable = true;
      result.latestBuildId = gameUpdate.latestBuildId;
    }
  }

  if (result.updatedMods.length > 0 || result.gameUpdateAvailable) {
    const parts: string[] = [];
    if (result.updatedMods.length > 0) {
      parts.push(`${result.updatedMods.length} mod update(s)`);
    }
    if (result.gameUpdateAvailable) {
      parts.push(`game server update (build ${result.latestBuildId})`);
    }

    broadcast("update:detected", {
      serverId,
      mods: result.updatedMods,
      gameUpdateAvailable: result.gameUpdateAvailable,
      latestBuildId: result.latestBuildId,
      message: `Updates available: ${parts.join(", ")}`,
    });
  }

  // Signal completion to the dialog
  const completeParts: string[] = [];
  if (result.updatedMods.length > 0) {
    completeParts.push(`${result.updatedMods.length} mod update(s)`);
  }
  if (result.gameUpdateAvailable) {
    completeParts.push(`game server update (build ${result.latestBuildId})`);
  }
  broadcast("update-check:complete", {
    serverId,
    success: true,
    message:
      completeParts.length > 0
        ? `Updates found: ${completeParts.join(", ")}`
        : result.loginRequired
          ? "Game update check skipped — Steam login required"
          : "Everything is up to date",
    updatedMods: result.updatedMods,
    gameUpdateAvailable: result.gameUpdateAvailable,
    latestBuildId: result.latestBuildId,
    loginRequired: result.loginRequired,
  });

  return result;
}

/**
 * Initialize update checkers for a list of running server IDs.
 * Called from serverProcess.restoreServerStates() or app startup.
 */
export function initializeUpdateCheckers(runningServerIds: number[]): void {
  let started = 0;

  for (const serverId of runningServerIds) {
    const settings = getUpdateRestartSettings(serverId);
    if (settings.enabled) {
      startUpdateChecker(serverId);
      started++;
    }
  }

  if (started > 0) {
    logger.info(
      `[UpdateChecker] Initialized update checkers for ${started} server(s)`,
    );
  }
}

/**
 * Check if a server has a pending update restart
 */
export function hasPendingUpdateRestart(serverId: number): boolean {
  return pendingUpdateRestarts.has(serverId);
}
