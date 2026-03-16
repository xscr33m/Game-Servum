/**
 * Server Installation Service
 *
 * Handles the installation of game servers via SteamCMD.
 * Supports:
 * - Progress tracking via WebSocket
 * - Anonymous and authenticated downloads
 * - Post-install hooks for initial configuration
 */

import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { getConfig, getSteamCMDExecutable } from "./config.js";
import { broadcast, logger } from "../index.js";
import { updateServerStatus, getSteamConfig } from "../db/index.js";
import {
  getGameDefinition,
  getGameDefinitionByAppId,
  runPostInstall,
} from "../games/index.js";

// Track active installations with buffered output & progress
interface ActiveInstallation {
  process: ChildProcess;
  gameId: string;
  outputLines: string[];
  percent: number;
  progressMessage: string;
  progressStatus: string;
}

const activeInstallations: Map<number, ActiveInstallation> = new Map();

// Installation queue — ensures only one SteamCMD install runs at a time
const installQueue: InstallOptions[] = [];
let isProcessingQueue = false;

export interface InstallOptions {
  serverId: number;
  gameId: string;
  appId: number;
  installPath: string;
  serverName: string;
  port: number;
  useAnonymous: boolean;
  username?: string | null;
  password?: string | null;
}

export interface InstallResult {
  success: boolean;
  message: string;
}

/**
 * Install a game server via SteamCMD
 */
export async function installServer(
  options: InstallOptions,
): Promise<InstallResult> {
  const { serverId, gameId, appId, installPath, serverName, useAnonymous } =
    options;

  // Check if already installing
  if (activeInstallations.has(serverId)) {
    return { success: false, message: "Installation already in progress" };
  }

  const executable = getSteamCMDExecutable();
  if (!fs.existsSync(executable)) {
    return { success: false, message: "SteamCMD not installed" };
  }

  // Ensure install directory exists
  if (!fs.existsSync(installPath)) {
    fs.mkdirSync(installPath, { recursive: true });
  }

  // Build SteamCMD command
  // Format: steamcmd +force_install_dir <path> +login <user> +app_update <appid> validate +quit
  let loginArg: string;
  if (useAnonymous) {
    loginArg = "anonymous";
  } else if (options.username) {
    loginArg = options.username;
  } else {
    // Fallback: try to get username from DB (for cached session)
    const steamConfig = getSteamConfig();
    loginArg =
      steamConfig?.username && steamConfig.isLoggedIn
        ? steamConfig.username
        : "anonymous";
  }

  const args = ["+force_install_dir", installPath, "+login", loginArg];

  // Add password if not anonymous
  if (!useAnonymous && options.password) {
    args.push(options.password);
  }

  // Add app update command
  args.push("+app_update", appId.toString(), "validate", "+quit");

  logger.info(`[Install] Starting installation for server ${serverId}`);
  logger.info(
    `[Install] Command: steamcmd ${args.map((a) => (a.includes(" ") ? `"${a}"` : a === options.password ? "********" : a)).join(" ")}`,
  );

  // Update server status to installing
  updateServerStatus(serverId, "installing", null);
  broadcast("install:progress", {
    serverId,
    gameId,
    status: "starting",
    message: `Starting installation of ${serverName}...`,
    percent: 0,
  });

  return new Promise((resolve) => {
    const proc = spawn(executable, args, {
      cwd: path.dirname(executable),
      stdio: ["pipe", "pipe", "pipe"],
    });

    activeInstallations.set(serverId, {
      process: proc,
      gameId,
      outputLines: [],
      percent: 0,
      progressMessage: `Starting installation of ${serverName}...`,
      progressStatus: "starting",
    });

    let lastPercent = 0;
    let lastPhase = "";

    // ── Log-file polling (source of truth for output) ──
    const config = getConfig();
    const logFile = path.join(config.steamcmdPath, "logs", "console_log.txt");
    let lastLogSize = 0;
    let logPollInterval: ReturnType<typeof setInterval> | null = null;

    // Record initial log file size so we only read new content
    try {
      if (fs.existsSync(logFile)) {
        lastLogSize = fs.statSync(logFile).size;
      }
    } catch {
      // Ignore — file may not exist yet
    }

    const cleanupPoll = () => {
      if (logPollInterval) {
        clearInterval(logPollInterval);
        logPollInterval = null;
      }
    };

    /**
     * Read new content appended to console_log.txt since last check.
     * Broadcasts cleaned lines and parses progress.
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

        // Strip timestamps like "[2026-02-08 19:28:52] " and broadcast clean lines
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
          logger.debug(`[Install ${serverId}]:`, line);
          broadcast("steamcmd:output", { message: line, serverId });

          // Buffer output line for REST endpoint
          const entry = activeInstallations.get(serverId);
          if (entry) {
            entry.outputLines.push(line);
          }

          // Parse progress: "Update state (0x61) downloading, progress: 45.23 (… / …)"
          const progressMatch = line.match(
            /Update state\s+\(0x[0-9a-fA-F]+\)\s+(.+?),\s*progress:\s*([\d.]+)\s*\(/i,
          );
          if (progressMatch) {
            const phaseName = progressMatch[1].trim().toLowerCase();
            const percent = Math.round(parseFloat(progressMatch[2]));

            // Map SteamCMD phase names to display labels and status keys
            let status: string;
            let phaseLabel: string;
            if (phaseName.includes("preallocat")) {
              status = "preallocating";
              phaseLabel = "Preallocating";
            } else if (phaseName.includes("reconfigur")) {
              status = "reconfiguring";
              phaseLabel = "Reconfiguring";
            } else if (phaseName.includes("download")) {
              status = "downloading";
              phaseLabel = "Downloading";
            } else if (phaseName.includes("verif")) {
              status = "verifying";
              phaseLabel = "Verifying";
            } else if (phaseName.includes("commit")) {
              status = "committing";
              phaseLabel = "Committing";
            } else {
              status = "downloading";
              phaseLabel =
                phaseName.charAt(0).toUpperCase() + phaseName.slice(1);
            }

            // Broadcast when phase changes or percent changes
            if (status !== lastPhase || percent !== lastPercent) {
              lastPhase = status;
              lastPercent = percent;
              const label = `${phaseLabel}... ${percent}%`;

              // Update buffered progress state
              const progressEntry = activeInstallations.get(serverId);
              if (progressEntry) {
                progressEntry.percent = percent;
                progressEntry.progressMessage = label;
                progressEntry.progressStatus = status;
              }

              broadcast("install:progress", {
                serverId,
                gameId,
                status,
                message: label,
                percent,
              });
            }
          }

          // Final success line
          if (line.toLowerCase().includes("success! app")) {
            const successEntry = activeInstallations.get(serverId);
            if (successEntry) {
              successEntry.percent = 100;
              successEntry.progressMessage = "Download complete!";
              successEntry.progressStatus = "downloading";
            }

            broadcast("install:progress", {
              serverId,
              gameId,
              status: "downloading",
              message: "Download complete!",
              percent: 100,
            });
          }
        }
      } catch {
        // Ignore read errors (file locked, etc.)
      }
    };

    // Poll the log file every 500ms
    logPollInterval = setInterval(readNewLogContent, 500);

    // stdout/stderr — server-side logging only (log file is the source of truth)
    proc.stdout?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        logger.debug(`[Install ${serverId} stdout]:`, text);
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        logger.warn(`[Install ${serverId} stderr]:`, text);
      }
    });

    proc.on("close", async (code) => {
      logger.info(`[Install ${serverId}] Process exited with code ${code}`);
      activeInstallations.delete(serverId);

      // Read any remaining log content before evaluating
      readNewLogContent();
      cleanupPoll();

      if (code === 0) {
        // Installation successful, run post-install hook
        const postEntry = activeInstallations.get(serverId);
        if (postEntry) {
          postEntry.percent = 100;
          postEntry.progressMessage = "Running post-install configuration...";
          postEntry.progressStatus = "post-install";
        }

        broadcast("install:progress", {
          serverId,
          gameId,
          status: "post-install",
          message: "Running post-install configuration...",
          percent: 100,
        });

        try {
          await runPostInstall(gameId, installPath, serverName, options.port);

          updateServerStatus(serverId, "stopped", null);
          broadcast("install:complete", {
            serverId,
            gameId,
            success: true,
            message: "Installation complete!",
          });

          resolve({
            success: true,
            message: "Installation completed successfully",
          });
        } catch (postInstallError) {
          logger.error("[Install] Post-install error:", postInstallError);
          updateServerStatus(serverId, "stopped", null);
          broadcast("install:complete", {
            serverId,
            gameId,
            success: true,
            message: "Installation complete (post-install had warnings)",
          });

          resolve({
            success: true,
            message: "Installation complete with post-install warnings",
          });
        }
      } else {
        // Installation failed
        updateServerStatus(serverId, "error", null);
        broadcast("install:error", {
          serverId,
          gameId,
          message: `Installation failed (exit code: ${code})`,
        });

        resolve({
          success: false,
          message: `Installation failed with exit code ${code}`,
        });
      }
    });

    proc.on("error", (err) => {
      logger.error(`[Install ${serverId}] Process error:`, err);
      activeInstallations.delete(serverId);
      cleanupPoll();
      updateServerStatus(serverId, "error", null);

      broadcast("install:error", {
        serverId,
        gameId,
        message: `Failed to start installation: ${err.message}`,
      });

      resolve({
        success: false,
        message: `Failed to start SteamCMD: ${err.message}`,
      });
    });
  });
}

/**
 * Cancel an ongoing installation
 */
export function cancelInstallation(serverId: number): boolean {
  const installation = activeInstallations.get(serverId);
  if (installation) {
    installation.process.kill();
    activeInstallations.delete(serverId);
    updateServerStatus(serverId, "stopped", null);
    broadcast("install:progress", {
      serverId,
      gameId: installation.gameId,
      status: "cancelled",
      message: "Installation cancelled",
      percent: 0,
    });
    return true;
  }
  return false;
}

/**
 * Check if a server is currently being installed
 */
export function isInstalling(serverId: number): boolean {
  return activeInstallations.has(serverId);
}

/**
 * Get installation status for a server
 */
export function getInstallationStatus(serverId: number): {
  installing: boolean;
  gameId?: string;
} {
  const installation = activeInstallations.get(serverId);
  if (installation) {
    return { installing: true, gameId: installation.gameId };
  }
  return { installing: false };
}

/**
 * Get detailed installation progress for a server (for REST endpoint).
 * Returns buffered output lines + current progress percentage/status.
 */
export function getInstallationProgress(serverId: number): {
  installing: boolean;
  percent: number;
  status: string;
  message: string;
  output: string[];
} {
  const installation = activeInstallations.get(serverId);
  if (installation) {
    return {
      installing: true,
      percent: installation.percent,
      status: installation.progressStatus,
      message: installation.progressMessage,
      output: installation.outputLines,
    };
  }
  return { installing: false, percent: 0, status: "", message: "", output: [] };
}

/**
 * Update an existing server (re-run SteamCMD app_update)
 */
export async function updateServer(
  serverId: number,
  gameId: string,
  appId: number,
  installPath: string,
  serverName: string,
  port: number,
  useAnonymous: boolean,
  username?: string | null,
): Promise<InstallResult> {
  // Updates use the same process as installation
  return installServer({
    serverId,
    gameId,
    appId,
    installPath,
    serverName,
    port,
    useAnonymous,
    username,
  });
}

/**
 * Queue a server installation. If nothing is currently installing,
 * it starts immediately. Otherwise the server is marked "queued" and
 * will be processed when the current installation finishes.
 */
export function queueInstallation(options: InstallOptions): void {
  if (isProcessingQueue || activeInstallations.size > 0) {
    // Something is already installing — queue this one
    logger.info(
      `[Install] Queuing installation for server ${options.serverId} (${options.serverName})`,
    );
    updateServerStatus(options.serverId, "queued", null);
    broadcast("server:status", {
      serverId: options.serverId,
      status: "queued",
    });
    installQueue.push(options);
  } else {
    // Nothing running — start immediately
    processNextInstall(options);
  }
}

/**
 * Process the next install (either the provided options or the first item in the queue).
 */
function processNextInstall(options?: InstallOptions): void {
  const next = options || installQueue.shift();
  if (!next) {
    isProcessingQueue = false;
    return;
  }

  isProcessingQueue = true;
  installServer(next)
    .catch((err) => {
      logger.error(
        `[Install] Installation error for server ${next.serverId}:`,
        err,
      );
    })
    .finally(() => {
      // Process next item in the queue
      processNextInstall();
    });
}

/**
 * Check if a server is queued for installation
 */
export function isQueued(serverId: number): boolean {
  return installQueue.some((item) => item.serverId === serverId);
}

/**
 * Remove a server from the installation queue
 */
export function removeFromQueue(serverId: number): boolean {
  const index = installQueue.findIndex((item) => item.serverId === serverId);
  if (index !== -1) {
    installQueue.splice(index, 1);
    updateServerStatus(serverId, "stopped", null);
    broadcast("server:status", { serverId, status: "stopped" });
    logger.info(`[Install] Removed server ${serverId} from installation queue`);
    return true;
  }
  return false;
}
