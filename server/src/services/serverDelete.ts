/**
 * Server Deletion Service
 *
 * Handles background deletion of game servers without blocking the event loop.
 * The deletion process: cancel active installs → stop services → remove firewall
 * rules → delete files (async) → remove DB entry → broadcast completion.
 */

import fs from "fs";
import fsPromises from "fs/promises";
import { broadcast } from "../core/broadcast.js";
import { logger } from "../core/logger.js";
import { deleteServer, updateServerStatus } from "../db/index.js";
import {
  isInstalling,
  cancelInstallation,
  isQueued,
  removeFromQueue,
} from "./serverInstall.js";
import { stopPlayerTracking } from "./playerTracker.js";
import { clearSchedule } from "./scheduler.js";
import { stopMessageBroadcaster } from "./messageBroadcaster.js";
import { stopUpdateChecker } from "./updateChecker.js";
import { removeFirewallRules } from "./firewallManager.js";
import { cancelActiveBackup, cleanupServerBackups } from "./backupManager.js";

/**
 * Performs the actual server deletion in the background without blocking the event loop.
 * Called from the DELETE route after the response has been sent, and from
 * restoreServerStates() to resume interrupted deletions after agent restart.
 */
export async function performBackgroundDeletion(
  id: number,
  serverName: string,
  gameId: string,
  port: number,
  installPath: string,
  deleteBackups = false,
): Promise<void> {
  try {
    // Cancel active installations / dequeue
    if (isInstalling(id)) {
      cancelInstallation(id);
    }
    if (isQueued(id)) {
      removeFromQueue(id);
    }

    // Stop all services that may be running for this server
    stopPlayerTracking(id);
    clearSchedule(id);
    stopMessageBroadcaster(id);
    stopUpdateChecker(id);
    cancelActiveBackup(id);

    // Remove firewall rules (non-blocking, don't fail deletion)
    try {
      await removeFirewallRules(serverName, gameId, port);
      logger.info(`[Delete] Removed firewall rules for server: ${serverName}`);
    } catch (err) {
      logger.error(`[Delete] Failed to remove firewall rules: ${err}`);
    }

    // Delete server files asynchronously (non-blocking)
    if (installPath && fs.existsSync(installPath)) {
      await fsPromises.rm(installPath, { recursive: true, force: true });
      logger.info(`[Delete] Removed server files: ${installPath}`);
    }

    // Note: Backup files in data/backups/{serverId}/ are intentionally
    // preserved unless the user explicitly chose to delete them.
    if (deleteBackups) {
      cleanupServerBackups(id);
      logger.info(`[Delete] Removed backup files for server: ${serverName}`);
    }

    // Delete database entry
    deleteServer(id);
    logger.info(
      `[Delete] Server deleted successfully: ${serverName} (ID: ${id})`,
    );

    // Notify all clients that the server has been fully removed
    broadcast("server:deleted", { serverId: id });
  } catch (err) {
    logger.error(
      `[Delete] Background deletion failed for server ${serverName} (ID: ${id}): ${err}`,
    );
    // Set error status so the user can see something went wrong
    try {
      updateServerStatus(id, "error", null);
      broadcast("server:status", {
        serverId: id,
        status: "error",
        message: `Deletion failed: ${(err as Error).message}`,
      });
    } catch {
      // Server may already be gone from DB — nothing we can do
    }
  }
}
