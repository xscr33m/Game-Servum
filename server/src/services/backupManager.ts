/**
 * Backup Manager Service
 *
 * Handles creating and restoring game server backups.
 * Cold backup approach: stop server → archive → restart.
 * Uses streaming zip creation (archiver) for large files.
 */

import path from "path";
import fs from "fs";
import crypto from "crypto";
import archiver from "archiver";
import AdmZip from "adm-zip";
import { broadcast, logger } from "../index.js";
import { getConfig } from "./config.js";
import {
  getServerById,
  createBackupRecord,
  updateBackupRecord,
  deleteBackupRecord,
  getBackupById,
  getBackupsByServerId,
  getBackupSettings,
  getDb,
} from "../db/index.js";
import { getGameAdapter } from "../games/index.js";
import { isServerRunning, startServer, stopServer } from "./serverProcess.js";
import type { BackupTrigger, BackupMetadata } from "../types/index.js";

// ── State Tracking ─────────────────────────────────────────────────

const activeBackups = new Map<number, string>(); // serverId → backupId

export function isBackupRunning(serverId: number): boolean {
  return activeBackups.has(serverId);
}

// ── Public API ─────────────────────────────────────────────────────

export interface CreateBackupOptions {
  tag?: string;
  trigger?: BackupTrigger;
  /** Skip stop/start — caller manages server lifecycle (e.g., scheduler) */
  skipServerLifecycle?: boolean;
}

export interface BackupResult {
  success: boolean;
  message: string;
  backupId?: string;
}

export interface RestoreResult {
  success: boolean;
  message: string;
}

/**
 * Create a cold backup of a game server.
 * If the server is running and skipServerLifecycle is false, it will be stopped and restarted.
 */
export async function createBackup(
  serverId: number,
  options: CreateBackupOptions = {},
): Promise<BackupResult> {
  const server = getServerById(serverId);
  if (!server) {
    return { success: false, message: "Server not found" };
  }

  if (activeBackups.has(serverId)) {
    return {
      success: false,
      message: "A backup is already running for this server",
    };
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return { success: false, message: `No game adapter for ${server.gameId}` };
  }

  const trigger = options.trigger ?? "manual";
  const backupId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const startTime = Date.now();

  // Register active backup
  activeBackups.set(serverId, backupId);

  // Create DB record
  const fileName = `${timestamp.replace(/[:.]/g, "-")}_${trigger}.zip`;
  const backupDir = getBackupStoragePath(serverId);
  const filePath = path.join(backupDir, fileName);

  createBackupRecord({
    id: backupId,
    serverId: server.id,
    gameId: server.gameId,
    serverName: server.name,
    timestamp,
    tag: options.tag ?? null,
    trigger,
    status: "running",
    filePath: fileName,
  });

  broadcast("backup:started", {
    serverId,
    backupId,
    trigger,
    tag: options.tag ?? null,
  });

  let wasRunning = false;

  try {
    // Phase 1: Stop server if needed
    if (!options.skipServerLifecycle && isServerRunning(serverId)) {
      wasRunning = true;
      broadcast("backup:progress", {
        serverId,
        backupId,
        phase: "stopping",
        percent: null,
        message: "Stopping server for backup...",
      });

      const stopResult = await stopServer(serverId);
      if (!stopResult.success) {
        throw new Error(`Failed to stop server: ${stopResult.message}`);
      }

      // Wait briefly for process cleanup
      await sleep(2000);
    }

    // Phase 2: Archive
    broadcast("backup:progress", {
      serverId,
      backupId,
      phase: "archiving",
      percent: 0,
      message: "Creating backup archive...",
    });

    // Resolve backup paths from adapter + custom settings
    const backupPaths = adapter.getBackupPaths(server);
    const settings = getBackupSettings(serverId);
    const customIncludes = settings?.customIncludePaths ?? [];
    const customExcludes = settings?.customExcludePaths ?? [];

    const allPaths = [
      ...backupPaths.savePaths,
      ...backupPaths.configPaths,
      ...customIncludes,
    ];

    if (allPaths.length === 0) {
      throw new Error("No backup paths configured for this game");
    }

    // Ensure backup directory exists
    fs.mkdirSync(backupDir, { recursive: true });

    // Create zip archive
    const { fileCount, sizeBytes } = await createZipArchive(
      server.installPath,
      filePath,
      allPaths,
      [...backupPaths.excludePatterns, ...customExcludes],
      (percent, msg) => {
        broadcast("backup:progress", {
          serverId,
          backupId,
          phase: "archiving",
          percent,
          message: msg,
        });
      },
    );

    // Phase 3: Restart server if it was running
    if (wasRunning && !options.skipServerLifecycle) {
      broadcast("backup:progress", {
        serverId,
        backupId,
        phase: "starting",
        percent: null,
        message: "Restarting server...",
      });

      startServer(serverId);
    }

    // Phase 4: Retention cleanup
    broadcast("backup:progress", {
      serverId,
      backupId,
      phase: "cleanup",
      percent: null,
      message: "Applying retention policy...",
    });

    applyRetention(serverId);

    const durationMs = Date.now() - startTime;

    // Update record
    updateBackupRecord(backupId, {
      status: "success",
      sizeBytes,
      fileCount,
      durationMs,
    });

    activeBackups.delete(serverId);

    broadcast("backup:complete", {
      serverId,
      backupId,
      sizeBytes,
      fileCount,
      durationMs,
    });

    logger.info(
      `[Backup] Backup complete for server ${serverId}: ${fileCount} files, ${formatBytes(sizeBytes)}, ${(durationMs / 1000).toFixed(1)}s`,
    );

    return { success: true, message: "Backup created successfully", backupId };
  } catch (error) {
    const errorMsg = (error as Error).message;
    logger.error(`[Backup] Backup failed for server ${serverId}: ${errorMsg}`);

    updateBackupRecord(backupId, {
      status: "failed",
      errorMessage: errorMsg,
      durationMs: Date.now() - startTime,
    });

    activeBackups.delete(serverId);

    // Ensure server is restarted if we stopped it
    if (wasRunning && !options.skipServerLifecycle) {
      try {
        logger.info(
          `[Backup] Restarting server ${serverId} after failed backup`,
        );
        startServer(serverId);
      } catch (restartErr) {
        logger.error(
          `[Backup] Failed to restart server after backup failure: ${(restartErr as Error).message}`,
        );
      }
    }

    broadcast("backup:failed", { serverId, backupId, error: errorMsg });

    return { success: false, message: `Backup failed: ${errorMsg}` };
  }
}

/**
 * Restore a backup to a game server.
 * Server MUST be stopped before restoring.
 */
export async function restoreBackup(
  serverId: number,
  backupId: string,
  options: { preRestoreBackup?: boolean } = {},
): Promise<RestoreResult> {
  const server = getServerById(serverId);
  if (!server) {
    return { success: false, message: "Server not found" };
  }

  if (isServerRunning(serverId)) {
    return {
      success: false,
      message: "Server must be stopped before restoring a backup",
    };
  }

  if (activeBackups.has(serverId)) {
    return {
      success: false,
      message: "A backup operation is already running for this server",
    };
  }

  const backup = getBackupById(backupId);
  if (!backup) {
    return { success: false, message: "Backup not found" };
  }
  if (backup.serverId !== serverId) {
    return { success: false, message: "Backup does not belong to this server" };
  }
  if (backup.status !== "success") {
    return {
      success: false,
      message: "Cannot restore a backup that is not successful",
    };
  }

  const backupDir = getBackupStoragePath(serverId);
  // backup record stores just the filename
  const backupFilePath = path.join(
    backupDir,
    path.basename(backup.id + ".zip"),
  );
  // Try the actual file_path stored in DB (the fileName we generated)
  const storedFileName = getStoredFilePath(backupId);
  const zipPath = storedFileName
    ? path.join(backupDir, path.basename(storedFileName))
    : backupFilePath;

  if (!fs.existsSync(zipPath)) {
    return { success: false, message: "Backup file not found on disk" };
  }

  // Create pre-restore backup if requested
  if (options.preRestoreBackup) {
    const preResult = await createBackup(serverId, {
      trigger: "pre-restore",
      tag: "pre-restore",
    });
    if (!preResult.success) {
      return {
        success: false,
        message: `Pre-restore backup failed: ${preResult.message}`,
      };
    }
  }

  broadcast("restore:started", { serverId, backupId });

  try {
    logger.info(`[Backup] Restoring backup ${backupId} to server ${serverId}`);

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(server.installPath, true);

    broadcast("restore:complete", { serverId, backupId, success: true });

    logger.info(`[Backup] Restore complete for server ${serverId}`);
    return { success: true, message: "Backup restored successfully" };
  } catch (error) {
    const errorMsg = (error as Error).message;
    logger.error(`[Backup] Restore failed for server ${serverId}: ${errorMsg}`);

    broadcast("restore:complete", {
      serverId,
      backupId,
      success: false,
      error: errorMsg,
    });

    return { success: false, message: `Restore failed: ${errorMsg}` };
  }
}

/**
 * Delete a specific backup.
 */
export function deleteBackup(serverId: number, backupId: string): BackupResult {
  const backup = getBackupById(backupId);
  if (!backup) {
    return { success: false, message: "Backup not found" };
  }
  if (backup.serverId !== serverId) {
    return { success: false, message: "Backup does not belong to this server" };
  }
  if (backup.status === "running") {
    return { success: false, message: "Cannot delete a running backup" };
  }

  // Delete file
  const backupDir = getBackupStoragePath(serverId);
  const storedFileName = getStoredFilePath(backupId);
  if (storedFileName) {
    const filePath = path.join(backupDir, path.basename(storedFileName));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  deleteBackupRecord(backupId);
  return { success: true, message: "Backup deleted" };
}

/**
 * Cancel a running backup for a server (best-effort).
 */
export function cancelActiveBackup(serverId: number): void {
  activeBackups.delete(serverId);
}

/**
 * Clean up all backup files for a server (used when deleting a server).
 */
export function cleanupServerBackups(serverId: number): void {
  const backupDir = getBackupStoragePath(serverId);
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

// ── Retention Policy ───────────────────────────────────────────────

export function applyRetention(serverId: number): void {
  const settings = getBackupSettings(serverId);
  if (!settings) return;

  const backups = getBackupsByServerId(serverId).filter(
    (b) => b.status === "success",
  );

  // Already sorted DESC by timestamp from DB query
  let toDelete: BackupMetadata[] = [];

  // Count-based retention
  if (settings.retentionCount > 0 && backups.length > settings.retentionCount) {
    toDelete.push(...backups.slice(settings.retentionCount));
  }

  // Age-based retention
  if (settings.retentionDays > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - settings.retentionDays);
    const cutoffStr = cutoff.toISOString();
    for (const backup of backups) {
      if (backup.timestamp < cutoffStr && !toDelete.includes(backup)) {
        toDelete.push(backup);
      }
    }
  }

  for (const backup of toDelete) {
    deleteBackup(serverId, backup.id);
  }

  if (toDelete.length > 0) {
    logger.info(
      `[Backup] Retention: deleted ${toDelete.length} old backup(s) for server ${serverId}`,
    );
  }
}

// ── Helpers ────────────────────────────────────────────────────────

export function getBackupStoragePath(serverId: number): string {
  return path.join(getConfig().dataPath, "backups", String(serverId));
}

function getStoredFilePath(backupId: string): string | null {
  const result = getDb().exec(
    "SELECT file_path FROM server_backups WHERE id = ?",
    [backupId],
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  return result[0].values[0][0] as string | null;
}

/**
 * Create a zip archive from specified paths within a root directory.
 * Uses streaming to handle large files without excessive memory.
 */
function createZipArchive(
  rootDir: string,
  outputPath: string,
  includePaths: string[],
  excludePatterns: string[],
  onProgress: (percent: number, message: string) => void,
): Promise<{ fileCount: number; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 6 } });

    let fileCount = 0;

    archive.on("entry", () => {
      fileCount++;
      if (fileCount % 50 === 0) {
        onProgress(
          Math.min(
            99,
            Math.round((fileCount / Math.max(fileCount + 10, 1)) * 100),
          ),
          `Archiving... ${fileCount} files`,
        );
      }
    });

    archive.on("error", (err) => {
      reject(err);
    });

    output.on("close", () => {
      const sizeBytes = archive.pointer();
      resolve({ fileCount, sizeBytes });
    });

    archive.pipe(output);

    // Add each path
    for (const relPath of includePaths) {
      const absPath = path.join(rootDir, relPath);
      if (!fs.existsSync(absPath)) {
        logger.debug(`[Backup] Skipping missing path: ${relPath}`);
        continue;
      }

      // Security: ensure the path is within rootDir
      const resolved = path.resolve(absPath);
      if (!resolved.startsWith(path.resolve(rootDir))) {
        logger.warn(
          `[Backup] Skipping path outside server directory: ${relPath}`,
        );
        continue;
      }

      const stat = fs.statSync(absPath);
      if (stat.isDirectory()) {
        archive.directory(absPath, relPath, (entry) => {
          // Check exclude patterns
          const entryRelPath = path.join(relPath, entry.name);
          if (shouldExclude(entryRelPath, excludePatterns)) {
            return false;
          }
          return entry;
        });
      } else if (stat.isFile()) {
        if (!shouldExclude(relPath, excludePatterns)) {
          archive.file(absPath, { name: relPath });
        }
      }
    }

    archive.finalize();
  });
}

/**
 * Check if a path matches any exclude pattern.
 * Supports simple glob-like patterns: ** matches any path, * matches any segment.
 */
function shouldExclude(filePath: string, patterns: string[]): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of patterns) {
    const normalizedPattern = pattern.replace(/\\/g, "/");
    if (matchGlob(normalized, normalizedPattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Simple glob matching supporting * and ** patterns.
 */
function matchGlob(str: string, pattern: string): boolean {
  // Convert glob to regex
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
    .replace(/\*\*/g, "{{GLOBSTAR}}") // Placeholder for **
    .replace(/\*/g, "[^/]*") // * matches within segment
    .replace(/{{GLOBSTAR}}/g, ".*"); // ** matches everything

  return new RegExp(`^${regexStr}$`, "i").test(str);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
