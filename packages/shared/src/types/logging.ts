/**
 * Logging Types
 * Shared across Backend, Electron Main, and Client
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  data?: unknown;
  error?: {
    message: string;
    stack?: string;
  };
}

export interface LoggerSettings {
  enabled: boolean;
  minLevel: LogLevel;
  retentionDays: number; // 0 = keep forever
  maxFileSizeMB: number;
  writeToConsole: boolean;
  includeStackTrace: boolean;
}

export const DEFAULT_LOG_SETTINGS: LoggerSettings = {
  enabled: true,
  minLevel: LogLevel.INFO,
  retentionDays: 30,
  maxFileSizeMB: 50,
  writeToConsole: false, // Only in dev mode
  includeStackTrace: true,
};

export function logLevelToString(level: LogLevel): string {
  return LogLevel[level];
}

export function logLevelFromString(level: string): LogLevel {
  return LogLevel[level as keyof typeof LogLevel] ?? LogLevel.INFO;
}
