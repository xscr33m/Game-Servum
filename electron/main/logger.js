/**
 * Simple Logger Service for Electron Main Process
 * Zero dependencies - uses only Node.js fs module
 * Supports daily rotation, buffering, and automatic cleanup
 *
 * SYNC: LogLevel, DEFAULT_LOG_SETTINGS, and SimpleLogger are manually ported
 * from packages/shared/src/types/logging.ts and server/src/services/logger.ts.
 * This file is plain CommonJS (no TS compilation) — keep in sync manually.
 */

const fs = require("fs");
const path = require("path");

const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const DEFAULT_LOG_SETTINGS = {
  enabled: true,
  minLevel: LogLevel.INFO,
  retentionDays: 30,
  maxFileSizeMB: 50,
  writeToConsole: false,
  includeStackTrace: true,
};

class SimpleLogger {
  constructor(context, logsDir, settings) {
    this.context = context; // 'agent', or 'commander'
    this.logsDir = logsDir;
    this.currentDate = this.getDate();
    this.buffer = [];
    this.bufferSize = 100;
    this.settings = settings || { ...DEFAULT_LOG_SETTINGS };
    this.flushInterval = null;
    this.rotationCheckInterval = null;

    this.ensureLogDir();
    this.startBufferFlush();
    this.startDailyRotationCheck();
  }

  /**
   * Update logger settings at runtime
   */
  updateSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    // Flush buffer when settings change
    this.flush();
  }

  /**
   * Get current settings
   */
  getSettings() {
    return { ...this.settings };
  }

  /**
   * Ensure log directory exists
   */
  ensureLogDir() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Get current date string (YYYY-MM-DD)
   */
  getDate() {
    const now = new Date();
    return now.toISOString().split("T")[0];
  }

  /**
   * Get log file path for current date
   */
  getLogFilePath() {
    const date = this.getDate();
    if (date !== this.currentDate) {
      this.currentDate = date;
      this.onDateChange();
    }
    return path.join(this.logsDir, `${this.context}-${date}.log`);
  }

  /**
   * Handle date change (midnight rotation)
   */
  onDateChange() {
    // Flush buffer before switching file
    this.flush();
    // Clean old logs based on retention
    this.cleanOldLogs();
  }

  /**
   * Start periodic buffer flush (every 5 seconds)
   */
  startBufferFlush() {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 5000);
  }

  /**
   * Start daily rotation check (every hour)
   */
  startDailyRotationCheck() {
    this.rotationCheckInterval = setInterval(
      () => {
        const date = this.getDate();
        if (date !== this.currentDate) {
          this.onDateChange();
        }
      },
      60 * 60 * 1000,
    ); // Check every hour
  }

  /**
   * Stop all timers (call on shutdown)
   */
  shutdown() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    if (this.rotationCheckInterval) {
      clearInterval(this.rotationCheckInterval);
      this.rotationCheckInterval = null;
    }
    this.flush();
  }

  /**
   * Write log entry
   */
  write(level, message, data) {
    if (!this.settings.enabled) return;
    if (level < this.settings.minLevel) return;

    const entry = this.formatLogEntry(level, message, data);

    // Add to buffer
    this.buffer.push(entry);

    // Flush if buffer full
    if (this.buffer.length >= this.bufferSize) {
      this.flush();
    }

    // Also write to console if enabled
    if (this.settings.writeToConsole) {
      const consoleMethod =
        level === LogLevel.ERROR
          ? "error"
          : level === LogLevel.WARN
            ? "warn"
            : "log";
      console[consoleMethod](entry);
    }
  }

  /**
   * Flush buffer to disk
   */
  flush() {
    if (this.buffer.length === 0) return;

    const logFile = this.getLogFilePath();
    const content = this.buffer.join("\n") + "\n";

    try {
      fs.appendFileSync(logFile, content, "utf-8");
      this.buffer = [];
    } catch (err) {
      console.error("[Logger] Failed to write logs:", err);
    }
  }

  /**
   * Format log entry as string
   */
  formatLogEntry(level, message, data) {
    const timestamp = new Date().toISOString();
    const levelStr = this.logLevelToString(level).padEnd(5);

    let entry = `[${timestamp}] ${levelStr} ${message}`;

    if (data !== undefined && data !== null) {
      if (data instanceof Error) {
        entry += `\n  Error: ${data.message}`;
        if (this.settings.includeStackTrace && data.stack) {
          const stackLines = data.stack.split("\n").slice(1); // Skip first line (message)
          entry += `\n  Stack:\n    ${stackLines.join("\n    ")}`;
        }
      } else if (typeof data === "object") {
        try {
          entry += `\n  Data: ${JSON.stringify(data, null, 2).split("\n").join("\n  ")}`;
        } catch {
          entry += `\n  Data: [Circular or non-serializable]`;
        }
      } else {
        entry += `\n  Data: ${String(data)}`;
      }
    }

    return entry;
  }

  /**
   * Convert log level to string
   */
  logLevelToString(level) {
    const entries = Object.entries(LogLevel);
    for (const [key, value] of entries) {
      if (value === level) return key;
    }
    return "INFO";
  }

  /**
   * Clean old log files based on retention settings
   */
  cleanOldLogs() {
    if (this.settings.retentionDays === 0) return; // Keep forever

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.settings.retentionDays);

      const files = fs.readdirSync(this.logsDir);

      for (const file of files) {
        if (!file.startsWith(this.context)) continue;

        const match = file.match(/(\d{4}-\d{2}-\d{2})\.log$/);
        if (!match) continue;

        const fileDate = new Date(match[1]);
        if (fileDate < cutoffDate) {
          fs.unlinkSync(path.join(this.logsDir, file));
        }
      }
    } catch (err) {
      console.error("[Logger] Failed to clean old logs:", err);
    }
  }

  /**
   * Get list of available log dates
   */
  getAvailableDates() {
    try {
      const files = fs.readdirSync(this.logsDir);
      const dates = files
        .filter((f) => f.startsWith(this.context) && f.endsWith(".log"))
        .map((f) => {
          const match = f.match(/(\d{4}-\d{2}-\d{2})/);
          return match ? match[1] : null;
        })
        .filter((d) => d !== null)
        .sort()
        .reverse();

      return dates;
    } catch {
      return [];
    }
  }

  /**
   * Read log file for specific date
   */
  readLog(date, options = {}) {
    const logFile = path.join(this.logsDir, `${this.context}-${date}.log`);

    if (!fs.existsSync(logFile)) {
      return { lines: [], totalLines: 0 };
    }

    try {
      const content = fs.readFileSync(logFile, "utf-8");
      let lines = content.split("\n").filter((l) => l.length > 0);

      // Filter by level
      if (options.level !== undefined) {
        const levelStr = this.logLevelToString(options.level);
        lines = lines.filter((l) => l.includes(`[${levelStr}]`));
      }

      // Filter by search
      if (options.search) {
        const searchLower = options.search.toLowerCase();
        lines = lines.filter((l) => l.toLowerCase().includes(searchLower));
      }

      const totalLines = lines.length;

      // Apply limit (last N lines)
      if (options.limit && options.limit > 0) {
        lines = lines.slice(-options.limit);
      }

      return { lines, totalLines };
    } catch (err) {
      console.error("[Logger] Failed to read log:", err);
      return { lines: [], totalLines: 0 };
    }
  }

  /**
   * Delete log file for specific date
   */
  deleteLog(date) {
    const logFile = path.join(this.logsDir, `${this.context}-${date}.log`);

    if (!fs.existsSync(logFile)) {
      return false;
    }

    try {
      fs.unlinkSync(logFile);
      return true;
    } catch (err) {
      console.error("[Logger] Failed to delete log:", err);
      return false;
    }
  }

  // ── Public API ──

  debug(message, data) {
    this.write(LogLevel.DEBUG, message, data);
  }

  info(message, data) {
    this.write(LogLevel.INFO, message, data);
  }

  warn(message, data) {
    this.write(LogLevel.WARN, message, data);
  }

  error(message, error, data) {
    // Handle both error(msg, err) and error(msg, data)
    if (error instanceof Error) {
      this.write(LogLevel.ERROR, message, error);
    } else {
      this.write(LogLevel.ERROR, message, error || data);
    }
  }
}

module.exports = { SimpleLogger, DEFAULT_LOG_SETTINGS };
