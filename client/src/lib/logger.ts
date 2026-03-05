/**
 * Client Logger
 * Sends logs to Electron Main Process via IPC
 * In browser mode, falls back to console
 */

const isElectron = typeof window !== "undefined" && "electronAPI" in window;

class ClientLogger {
  private isElectron: boolean;

  constructor() {
    this.isElectron = isElectron;
  }

  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data?: unknown,
  ): void {
    if (this.isElectron && window.electronAPI?.logger) {
      window.electronAPI.logger[level](message, data);
    } else {
      // Fallback to console in browser mode
      const consoleMethod =
        level === "error" ? "error" : level === "warn" ? "warn" : "log";
      console[consoleMethod](`[${level.toUpperCase()}] ${message}`, data);
    }
  }

  debug(message: string, data?: unknown): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: unknown): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log("warn", message, data);
  }

  error(message: string, error?: Error | unknown, data?: unknown): void {
    // Handle both error(msg, err) and error(msg, data)
    if (error instanceof Error) {
      this.log("error", message, {
        error: {
          message: error.message,
          stack: error.stack,
        },
      });
    } else {
      this.log("error", message, error || data);
    }
  }
}

// Singleton instance
export const logger = new ClientLogger();
