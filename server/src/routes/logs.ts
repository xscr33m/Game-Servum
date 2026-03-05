/**
 * Logs API Routes
 * Provides access to application logs and log management
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { logger } from "../index.js";
import path from "path";
import fs from "fs";
import { getConfig } from "../services/config.js";

const router = Router();
const config = getConfig();

/**
 * GET /api/v1/logs/settings
 * Get current logger settings
 */
router.get("/settings", (req: Request, res: Response) => {
  try {
    const settings = logger.getSettings();
    res.json({ success: true, settings });
  } catch (err) {
    logger.error("[LogsAPI] Failed to get settings:", err);
    res.status(500).json({
      success: false,
      message: "Failed to get log settings",
    });
  }
});

/**
 * PUT /api/v1/logs/settings
 * Update logger settings
 */
router.put("/settings", (req: Request, res: Response) => {
  try {
    const updates = req.body;
    logger.updateSettings(updates);
    logger.info("[LogsAPI] Updated logger settings", updates);

    res.json({
      success: true,
      message: "Log settings updated successfully",
      settings: logger.getSettings(),
    });
  } catch (err) {
    logger.error("[LogsAPI] Failed to update settings:", err);
    res.status(500).json({
      success: false,
      message: "Failed to update log settings",
    });
  }
});

/**
 * GET /api/v1/logs/files
 * List available log files
 */
router.get("/files", (req: Request, res: Response) => {
  try {
    const logsDir = config.logsPath;

    if (!fs.existsSync(logsDir)) {
      return res.json({ success: true, files: [] });
    }

    const files = fs
      .readdirSync(logsDir)
      .filter((file) => file.endsWith(".log"))
      .map((file) => {
        const filePath = path.join(logsDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: stats.size,
          modified: stats.mtime.toISOString(),
        };
      })
      .sort(
        (a, b) =>
          new Date(b.modified).getTime() - new Date(a.modified).getTime(),
      );

    res.json({ success: true, files });
  } catch (err) {
    logger.error("[LogsAPI] Failed to list log files:", err);
    res.status(500).json({
      success: false,
      message: "Failed to list log files",
    });
  }
});

/**
 * GET /api/v1/logs/files/:filename
 * Get content of a specific log file
 * Query params:
 *   - lines: number of lines to return (default: all)
 *   - tail: if true, return last N lines (default: false)
 */
router.get("/files/:filename", (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const lines = req.query.lines
      ? parseInt(req.query.lines as string)
      : undefined;
    const tail = req.query.tail === "true";

    // Security: Prevent path traversal
    if (
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\")
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid filename",
      });
    }

    const logsDir = config.logsPath;
    const filePath = path.join(logsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: "Log file not found",
      });
    }

    let content = fs.readFileSync(filePath, "utf-8");

    // Apply line filtering if requested
    if (lines) {
      const allLines = content.split("\n");
      if (tail) {
        content = allLines.slice(-lines).join("\n");
      } else {
        content = allLines.slice(0, lines).join("\n");
      }
    }

    res.json({
      success: true,
      filename,
      content,
    });
  } catch (err) {
    logger.error("[LogsAPI] Failed to read log file:", err);
    res.status(500).json({
      success: false,
      message: "Failed to read log file",
    });
  }
});

/**
 * POST /api/v1/logs/cleanup
 * Manually trigger cleanup of old log files
 */
router.post("/cleanup", (req: Request, res: Response) => {
  try {
    const { retentionDays } = req.body;

    if (typeof retentionDays !== "number" || retentionDays < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid retentionDays parameter",
      });
    }

    const deletedCount = logger.cleanOldLogs(retentionDays);
    logger.info(
      `[LogsAPI] Manual cleanup: deleted ${deletedCount} old log files`,
    );

    res.json({
      success: true,
      message: `Deleted ${deletedCount} old log files`,
      deletedCount,
    });
  } catch (err) {
    logger.error("[LogsAPI] Failed to cleanup logs:", err);
    res.status(500).json({
      success: false,
      message: "Failed to cleanup logs",
    });
  }
});

/**
 * DELETE /api/v1/logs/files/:filename
 * Delete a specific log file
 */
router.delete("/files/:filename", (req: Request, res: Response) => {
  try {
    const { filename } = req.params;

    // Security: Prevent path traversal
    if (
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\")
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid filename",
      });
    }

    const logsDir = config.logsPath;
    const filePath = path.join(logsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: "Log file not found",
      });
    }

    fs.unlinkSync(filePath);
    logger.info(`[LogsAPI] Deleted log file: ${filename}`);

    res.json({
      success: true,
      message: `Log file ${filename} deleted successfully`,
    });
  } catch (err) {
    logger.error("[LogsAPI] Failed to delete log file:", err);
    res.status(500).json({
      success: false,
      message: "Failed to delete log file",
    });
  }
});

export default router;
