/**
 * Log Manager Service
 *
 * Handles log file archiving and cleanup for game servers.
 *
 * - **Archiving**: On server start, moves existing log files (.ADM, .RPT, .log)
 *   from the profiles directory into a timestamped archive subfolder.
 * - **Cleanup**: Automatically deletes archived logs older than a configurable
 *   retention period (default: 30 days, 0 = keep forever).
 */

import path from "path";
import fs from "fs";
import { logger } from "../index.js";

const LOG_EXTENSIONS = [".ADM", ".RPT", ".log"];
const ARCHIVE_DIR_NAME = "log_archive";

/**
 * Resolve the profiles directory path.
 * If profilesPath is absolute, use it directly; otherwise join with installPath.
 * Falls back to installPath/profiles if profilesPath is not provided.
 */
function resolveProfilesPath(
  installPath: string,
  profilesPath?: string,
): string {
  if (!profilesPath) {
    return path.join(installPath, "profiles");
  }
  return path.isAbsolute(profilesPath)
    ? profilesPath
    : path.join(installPath, profilesPath);
}

/**
 * Check if a file is a log file based on its extension
 */
function isLogFile(filename: string): boolean {
  return LOG_EXTENSIONS.some((ext) =>
    filename.toUpperCase().endsWith(ext.toUpperCase()),
  );
}

/**
 * Archive existing log files before a server starts.
 * Moves all .ADM, .RPT, .log files from the profiles directory into profiles/log_archive/<timestamp>/
 * Returns the number of files archived.
 */
export function archiveLogsBeforeStart(
  installPath: string,
  serverProfilesPath?: string,
): number {
  const profilesPath = resolveProfilesPath(installPath, serverProfilesPath);

  if (!fs.existsSync(profilesPath)) {
    return 0;
  }

  // Find all log files in the profiles directory
  let logFiles: string[];
  try {
    logFiles = fs
      .readdirSync(profilesPath)
      .filter(
        (f) => isLogFile(f) && fs.statSync(path.join(profilesPath, f)).isFile(),
      );
  } catch (error) {
    logger.error(
      "[LogManager] Error scanning profiles directory:",
      (error as Error).message,
    );
    return 0;
  }

  if (logFiles.length === 0) {
    return 0;
  }

  // Create timestamped archive folder
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const archivePath = path.join(profilesPath, ARCHIVE_DIR_NAME, timestamp);

  try {
    fs.mkdirSync(archivePath, { recursive: true });
  } catch (error) {
    logger.error(
      "[LogManager] Failed to create archive directory:",
      (error as Error).message,
    );
    return 0;
  }

  let archivedCount = 0;
  for (const file of logFiles) {
    const src = path.join(profilesPath, file);
    const dest = path.join(archivePath, file);

    try {
      fs.renameSync(src, dest);
      archivedCount++;
    } catch (error) {
      // File might be locked — try copy + delete instead
      try {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
        archivedCount++;
      } catch (copyError) {
        logger.warn(
          `[LogManager] Could not archive ${file}: ${(copyError as Error).message}`,
        );
      }
    }
  }

  if (archivedCount > 0) {
    logger.info(
      `[LogManager] Archived ${archivedCount} log files to ${archivePath}`,
    );
  }

  return archivedCount;
}

/**
 * Get list of log files in the profiles directory (current session logs)
 */
export function getCurrentLogs(
  installPath: string,
  serverProfilesPath?: string,
): Array<{ name: string; path: string; size: number; modified: string }> {
  const profilesPath = resolveProfilesPath(installPath, serverProfilesPath);
  const logs: Array<{
    name: string;
    path: string;
    size: number;
    modified: string;
  }> = [];

  if (!fs.existsSync(profilesPath)) return logs;

  try {
    const files = fs.readdirSync(profilesPath);
    for (const file of files) {
      if (isLogFile(file)) {
        const filePath = path.join(profilesPath, file);
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          logs.push({
            name: file,
            path: filePath,
            size: stats.size,
            modified: stats.mtime.toISOString(),
          });
        }
      }
    }
  } catch (error) {
    logger.error(
      "[LogManager] Error reading current logs:",
      (error as Error).message,
    );
  }

  // Sort by modified date descending (newest first)
  logs.sort(
    (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime(),
  );
  return logs;
}

/**
 * Get list of archived log sessions (each is a timestamped folder)
 */
export function getArchivedSessions(
  installPath: string,
  serverProfilesPath?: string,
): Array<{
  name: string;
  date: string;
  fileCount: number;
  totalSize: number;
}> {
  const archivePath = path.join(
    resolveProfilesPath(installPath, serverProfilesPath),
    ARCHIVE_DIR_NAME,
  );

  if (!fs.existsSync(archivePath)) return [];

  const sessions: Array<{
    name: string;
    date: string;
    fileCount: number;
    totalSize: number;
  }> = [];

  try {
    const folders = fs
      .readdirSync(archivePath)
      .filter((f) => fs.statSync(path.join(archivePath, f)).isDirectory());

    for (const folder of folders) {
      const folderPath = path.join(archivePath, folder);
      const files = fs.readdirSync(folderPath).filter((f) => isLogFile(f));

      let totalSize = 0;
      for (const file of files) {
        try {
          totalSize += fs.statSync(path.join(folderPath, file)).size;
        } catch {
          // ignore
        }
      }

      // Parse timestamp from folder name (format: YYYY-MM-DD_HH-MM-SS)
      const dateStr = folder.replace("_", "T").replace(/-/g, (m, offset) => {
        // Replace dashes: first 2 are date separators, rest are time separators
        return offset > 9 ? ":" : "-";
      });
      let date: string;
      try {
        date = new Date(dateStr).toISOString();
      } catch {
        date = folder;
      }

      sessions.push({
        name: folder,
        date,
        fileCount: files.length,
        totalSize,
      });
    }
  } catch (error) {
    logger.error(
      "[LogManager] Error reading archive:",
      (error as Error).message,
    );
  }

  // Sort newest first
  sessions.sort((a, b) => b.name.localeCompare(a.name));
  return sessions;
}

/**
 * Get the files within an archived session
 */
export function getArchivedSessionFiles(
  installPath: string,
  sessionName: string,
  serverProfilesPath?: string,
): Array<{ name: string; path: string; size: number; modified: string }> {
  const sessionPath = path.join(
    resolveProfilesPath(installPath, serverProfilesPath),
    ARCHIVE_DIR_NAME,
    sessionName,
  );

  if (!fs.existsSync(sessionPath)) return [];

  const files: Array<{
    name: string;
    path: string;
    size: number;
    modified: string;
  }> = [];

  try {
    for (const file of fs.readdirSync(sessionPath)) {
      if (isLogFile(file)) {
        const filePath = path.join(sessionPath, file);
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          files.push({
            name: file,
            path: filePath,
            size: stats.size,
            modified: stats.mtime.toISOString(),
          });
        }
      }
    }
  } catch (error) {
    logger.error(
      "[LogManager] Error reading archived session:",
      (error as Error).message,
    );
  }

  files.sort(
    (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime(),
  );
  return files;
}

/**
 * Read content of a log file (current or archived)
 */
export function readLogContent(
  installPath: string,
  filename: string,
  maxLines: number,
  archiveSession?: string,
  serverProfilesPath?: string,
): { content: string; totalLines: number; returnedLines: number } | null {
  // Security: Only allow log file extensions
  if (!isLogFile(filename)) {
    return null;
  }

  // Security: Prevent path traversal
  const sanitizedFilename = path.basename(filename);
  const sanitizedSession = archiveSession
    ? path.basename(archiveSession)
    : undefined;

  const resolved = resolveProfilesPath(installPath, serverProfilesPath);
  let filePath: string;
  if (sanitizedSession) {
    filePath = path.join(
      resolved,
      ARCHIVE_DIR_NAME,
      sanitizedSession,
      sanitizedFilename,
    );
  } else {
    filePath = path.join(resolved, sanitizedFilename);
  }

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const allLines = content.split("\n");

    // maxLines <= 0 means return everything
    const returnedLines = maxLines > 0 ? allLines.slice(-maxLines) : allLines;

    return {
      content: returnedLines.join("\n"),
      totalLines: allLines.length,
      returnedLines: returnedLines.length,
    };
  } catch (error) {
    logger.error(
      "[LogManager] Error reading log file:",
      (error as Error).message,
    );
    return null;
  }
}

/**
 * Delete an entire archived session folder
 */
export function deleteArchivedSession(
  installPath: string,
  sessionName: string,
  serverProfilesPath?: string,
): boolean {
  // Security: Prevent path traversal
  const sanitized = path.basename(sessionName);
  const sessionPath = path.join(
    resolveProfilesPath(installPath, serverProfilesPath),
    ARCHIVE_DIR_NAME,
    sanitized,
  );

  if (!fs.existsSync(sessionPath)) {
    return false;
  }

  try {
    fs.rmSync(sessionPath, { recursive: true, force: true });
    logger.info(`[LogManager] Deleted archived session: ${sanitized}`);
    return true;
  } catch (error) {
    logger.error(
      "[LogManager] Failed to delete archived session:",
      (error as Error).message,
    );
    return false;
  }
}

/**
 * Clean up archived logs older than the specified retention period.
 * @param installPath Server install path
 * @param retentionDays Number of days to keep (0 = keep forever)
 * @returns Number of sessions deleted
 */
export function cleanupOldArchives(
  installPath: string,
  retentionDays: number,
  serverProfilesPath?: string,
): number {
  if (retentionDays <= 0) return 0;

  const archivePath = path.join(
    resolveProfilesPath(installPath, serverProfilesPath),
    ARCHIVE_DIR_NAME,
  );

  if (!fs.existsSync(archivePath)) return 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  let deletedCount = 0;

  try {
    const folders = fs
      .readdirSync(archivePath)
      .filter((f) => fs.statSync(path.join(archivePath, f)).isDirectory());

    for (const folder of folders) {
      const folderPath = path.join(archivePath, folder);

      // Use folder modification time as age indicator
      try {
        const stats = fs.statSync(folderPath);
        if (stats.mtime < cutoffDate) {
          fs.rmSync(folderPath, { recursive: true, force: true });
          deletedCount++;
          logger.info(`[LogManager] Auto-cleaned old archive: ${folder}`);
        }
      } catch {
        // ignore individual folder errors
      }
    }
  } catch (error) {
    logger.error(
      "[LogManager] Error during archive cleanup:",
      (error as Error).message,
    );
  }

  if (deletedCount > 0) {
    logger.info(`[LogManager] Cleaned up ${deletedCount} old archive(s)`);
  }

  return deletedCount;
}
