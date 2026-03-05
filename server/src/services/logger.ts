/**
 * Simple Logger Service
 * Zero dependencies - uses only Node.js fs module
 * Supports daily rotation, buffering, and automatic cleanup
 */

import fs from "fs";
import path from "path";
import {
  LogLevel,
  LoggerSettings,
  DEFAULT_LOG_SETTINGS,
  logLevelToString,
} from "@game-servum/shared";

type LogContext = "agent" | "dashboard";

class SimpleLogger {
  private context: LogContext;
  private logsDir: string;
  private currentDate: string;
  private buffer: string[] = [];
  private bufferSize: number = 100;
  private settings: LoggerSettings;
  private flushInterval: NodeJS.Timeout | null = null;
  private rotationCheckInterval: NodeJS.Timeout | null = null;

  constructor(context: LogContext, logsDir: string, settings?: LoggerSettings) {
    this.context = context;
    this.logsDir = logsDir;
    this.currentDate = this.getDate();
    this.settings = settings || { ...DEFAULT_LOG_SETTINGS };

    this.ensureLogDir();
    this.startBufferFlush();
    this.startDailyRotationCheck();
  }

  /**
   * Update logger settings at runtime
   */
  updateSettings(settings: Partial<LoggerSettings>): void {
    this.settings = { ...this.settings, ...settings };
    // Flush buffer when settings change
    this.flush();
  }

  /**
   * Get current settings
   */
  getSettings(): LoggerSettings {
    return { ...this.settings };
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDir(): void {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Get current date string (YYYY-MM-DD)
   */
  private getDate(): string {
    const now = new Date();
    return now.toISOString().split("T")[0];
  }

  /**
   * Get log file path for current date
   */
  private getLogFilePath(): string {
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
  private onDateChange(): void {
    // Flush buffer before switching file
    this.flush();
    // Clean old logs based on retention
    this.cleanOldLogs();
  }

  /**
   * Start periodic buffer flush (every 5 seconds)
   */
  private startBufferFlush(): void {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 5000);
  }

  /**
   * Start daily rotation check (every hour)
   */
  private startDailyRotationCheck(): void {
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
  shutdown(): void {
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
  private write(level: LogLevel, message: string, data?: unknown): void {
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
  private flush(): void {
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
  private formatLogEntry(
    level: LogLevel,
    message: string,
    data?: unknown,
  ): string {
    const timestamp = new Date().toISOString();
    const levelStr = logLevelToString(level).padEnd(5);

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
   * Clean old log files based on retention settings
   * @param retentionDays - Optional override for retention days
   * @returns Number of files deleted
   */
  cleanOldLogs(retentionDays?: number): number {
    const days = retentionDays ?? this.settings.retentionDays;
    if (days === 0) return 0; // Keep forever

    let deletedCount = 0;

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const files = fs.readdirSync(this.logsDir);

      for (const file of files) {
        if (!file.startsWith(this.context)) continue;

        const match = file.match(/(\d{4}-\d{2}-\d{2})\.log$/);
        if (!match) continue;

        const fileDate = new Date(match[1]);
        if (fileDate < cutoffDate) {
          fs.unlinkSync(path.join(this.logsDir, file));
          deletedCount++;
        }
      }
    } catch (err) {
      console.error("[Logger] Failed to clean old logs:", err);
    }

    return deletedCount;
  }

  /**
   * Get list of available log dates
   */
  getAvailableDates(): string[] {
    try {
      const files = fs.readdirSync(this.logsDir);
      const dates = files
        .filter((f) => f.startsWith(this.context) && f.endsWith(".log"))
        .map((f) => f.match(/(\d{4}-\d{2}-\d{2})/)?.[1])
        .filter((d): d is string => d !== undefined)
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
  readLog(
    date: string,
    options?: {
      level?: LogLevel;
      search?: string;
      limit?: number;
    },
  ): { lines: string[]; totalLines: number } {
    const logFile = path.join(this.logsDir, `${this.context}-${date}.log`);

    if (!fs.existsSync(logFile)) {
      return { lines: [], totalLines: 0 };
    }

    try {
      const content = fs.readFileSync(logFile, "utf-8");
      let lines = content.split("\n").filter((l) => l.length > 0);

      // Filter by level
      if (options?.level !== undefined) {
        const levelStr = logLevelToString(options.level);
        lines = lines.filter((l) => l.includes(`[${levelStr}]`));
      }

      // Filter by search
      if (options?.search) {
        const searchLower = options.search.toLowerCase();
        lines = lines.filter((l) => l.toLowerCase().includes(searchLower));
      }

      const totalLines = lines.length;

      // Apply limit (last N lines)
      if (options?.limit && options.limit > 0) {
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
  deleteLog(date: string): boolean {
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

  debug(message: string, data?: unknown): void {
    this.write(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: unknown): void {
    this.write(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: unknown): void {
    this.write(LogLevel.WARN, message, data);
  }

  error(message: string, error?: Error | unknown, data?: unknown): void {
    // Handle both error(msg, err) and error(msg, data)
    if (error instanceof Error) {
      this.write(LogLevel.ERROR, message, error);
    } else {
      this.write(LogLevel.ERROR, message, error || data);
    }
  }
}

export { SimpleLogger, LogContext };
