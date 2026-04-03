/**
 * Log Manager Service
 *
 * Handles log file archiving and cleanup for game servers.
 * Uses LogPaths from game adapters to support different games'
 * log directory structures and file extensions.
 *
 * - **Archiving**: On server start, moves existing log files from
 *   adapter-defined directories into a timestamped archive subfolder.
 * - **Cleanup**: Automatically deletes archived logs older than a
 *   configurable retention period (default: 30 days, 0 = keep forever).
 */

import path from "path";
import fs from "fs";
import { logger } from "../core/logger.js";
import { readGameFile } from "../games/encoding.js";
import type { LogPaths } from "../games/index.js";

/**
 * Check if a file is a log file based on its extension,
 * or by exact filename match when includeFiles is set.
 */
function isLogFile(
  filename: string,
  extensions: string[],
  includeFiles?: string[],
): boolean {
  if (includeFiles && includeFiles.length > 0) {
    return includeFiles.some((f) => f.toUpperCase() === filename.toUpperCase());
  }
  return extensions.some((ext) =>
    filename.toUpperCase().endsWith(ext.toUpperCase()),
  );
}

/**
 * Archive existing log files before a server starts.
 * Scans all directories in logPaths, moves matching files into
 * archiveDir/<timestamp>/
 * Returns the number of files archived.
 */
export function archiveLogsBeforeStart(logPaths: LogPaths): number {
  const { directories, extensions, archiveDir, includeFiles } = logPaths;

  // Collect log files from all source directories
  const filesToArchive: Array<{ src: string; name: string }> = [];
  for (const dir of directories) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir);
      for (const file of entries) {
        const filePath = path.join(dir, file);
        if (
          isLogFile(file, extensions, includeFiles) &&
          fs.statSync(filePath).isFile()
        ) {
          filesToArchive.push({ src: filePath, name: file });
        }
      }
    } catch (error) {
      logger.error(
        `[LogManager] Error scanning directory ${dir}:`,
        (error as Error).message,
      );
    }
  }

  if (filesToArchive.length === 0) {
    return 0;
  }

  // Create timestamped archive folder
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const archivePath = path.join(archiveDir, timestamp);

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
  for (const { src, name } of filesToArchive) {
    const dest = path.join(archivePath, name);

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
          `[LogManager] Could not archive ${name}: ${(copyError as Error).message}`,
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
 * Get list of current log files across all configured directories.
 */
export function getCurrentLogs(
  logPaths: LogPaths,
): Array<{ name: string; path: string; size: number; modified: string }> {
  const { directories, extensions } = logPaths;
  const logs: Array<{
    name: string;
    path: string;
    size: number;
    modified: string;
  }> = [];

  for (const dir of directories) {
    if (!fs.existsSync(dir)) continue;

    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (isLogFile(file, extensions, logPaths.includeFiles)) {
          const filePath = path.join(dir, file);
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
        `[LogManager] Error reading current logs from ${dir}:`,
        (error as Error).message,
      );
    }
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
export function getArchivedSessions(logPaths: LogPaths): Array<{
  name: string;
  date: string;
  fileCount: number;
  totalSize: number;
}> {
  const { archiveDir } = logPaths;

  if (!fs.existsSync(archiveDir)) return [];

  const sessions: Array<{
    name: string;
    date: string;
    fileCount: number;
    totalSize: number;
  }> = [];

  try {
    const folders = fs
      .readdirSync(archiveDir)
      .filter((f) => fs.statSync(path.join(archiveDir, f)).isDirectory());

    for (const folder of folders) {
      const folderPath = path.join(archiveDir, folder);
      const allFiles = fs.readdirSync(folderPath);

      let totalSize = 0;
      let fileCount = 0;
      for (const file of allFiles) {
        try {
          const stats = fs.statSync(path.join(folderPath, file));
          if (stats.isFile()) {
            totalSize += stats.size;
            fileCount++;
          }
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
        fileCount,
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
  logPaths: LogPaths,
  sessionName: string,
): Array<{ name: string; path: string; size: number; modified: string }> {
  const sessionPath = path.join(logPaths.archiveDir, sessionName);

  if (!fs.existsSync(sessionPath)) return [];

  const files: Array<{
    name: string;
    path: string;
    size: number;
    modified: string;
  }> = [];

  try {
    for (const file of fs.readdirSync(sessionPath)) {
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
 * Read content of a log file (current or archived).
 * For current logs, searches all configured directories.
 * For archived logs, reads from archiveDir/<session>/<filename>.
 */
export function readLogContent(
  logPaths: LogPaths,
  filename: string,
  maxLines: number,
  archiveSession?: string,
): { content: string; totalLines: number; returnedLines: number } | null {
  // Security: Only allow files matching configured log files/extensions
  if (!isLogFile(filename, logPaths.extensions, logPaths.includeFiles)) {
    return null;
  }

  // Security: Prevent path traversal
  const sanitizedFilename = path.basename(filename);
  const sanitizedSession = archiveSession
    ? path.basename(archiveSession)
    : undefined;

  let filePath: string | undefined;

  if (sanitizedSession) {
    // Archived log: look in archiveDir/<session>/
    filePath = path.join(
      logPaths.archiveDir,
      sanitizedSession,
      sanitizedFilename,
    );
  } else {
    // Current log: search across all configured directories
    for (const dir of logPaths.directories) {
      const candidate = path.join(dir, sanitizedFilename);
      if (fs.existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = readGameFile(filePath);
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
  logPaths: LogPaths,
  sessionName: string,
): boolean {
  // Security: Prevent path traversal
  const sanitized = path.basename(sessionName);
  const sessionPath = path.join(logPaths.archiveDir, sanitized);

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
 * @param logPaths Log path configuration
 * @param retentionDays Number of days to keep (0 = keep forever)
 * @returns Number of sessions deleted
 */
export function cleanupOldArchives(
  logPaths: LogPaths,
  retentionDays: number,
): number {
  if (retentionDays <= 0) return 0;

  const { archiveDir } = logPaths;

  if (!fs.existsSync(archiveDir)) return 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  let deletedCount = 0;

  try {
    const folders = fs
      .readdirSync(archiveDir)
      .filter((f) => fs.statSync(path.join(archiveDir, f)).isDirectory());

    for (const folder of folders) {
      const folderPath = path.join(archiveDir, folder);

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
