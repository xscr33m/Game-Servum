import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { config as dotenvConfig } from "dotenv";
import type { AppConfig } from "../types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In bundled mode, GAME_SERVUM_ROOT env var overrides the auto-detected root.
// The NSIS installer / launcher script sets this to the install directory.
const ROOT_DIR = process.env.GAME_SERVUM_ROOT
  ? path.resolve(process.env.GAME_SERVUM_ROOT)
  : path.resolve(__dirname, "..", "..", "..");

// Load .env from project root
dotenvConfig({ path: path.join(ROOT_DIR, ".env") });

let cachedConfig: AppConfig | null = null;

/**
 * Resolve a path from .env — if relative, resolves against ROOT_DIR.
 * Absolute paths are used as-is.
 */
function resolvePath(
  envValue: string | undefined,
  ...fallbackSegments: string[]
): string {
  if (envValue) {
    return path.isAbsolute(envValue)
      ? envValue
      : path.resolve(ROOT_DIR, envValue);
  }
  return path.resolve(ROOT_DIR, ...fallbackSegments);
}

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  cachedConfig = {
    // Pfade — konfigurierbar via Env-Vars, Fallback auf relative Pfade
    // Alle Pfade werden absolut aufgelöst (relativ zu ROOT_DIR)
    steamcmdPath: resolvePath(process.env.STEAMCMD_PATH, "steamcmd"),
    serversPath: resolvePath(process.env.SERVERS_PATH, "servers"),
    dataPath: resolvePath(process.env.DATA_PATH, "data"),
    backupsPath: resolvePath(process.env.BACKUPS_PATH, "backups"),
    logsPath: resolvePath(process.env.LOGS_PATH, "logs"),

    // Netzwerk
    port: parseInt(process.env.PORT || "3001", 10),
    host: process.env.HOST || "0.0.0.0",

    // CORS — Komma-separierte Liste erlaubter Origins
    corsOrigins: process.env.CORS_ORIGINS || "*",

    // Auth — standardmäßig aktiviert für sicheren Remote-Zugriff
    authEnabled: process.env.AUTH_ENABLED !== "false", // Default: aktiviert
    jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(64).toString("hex"),
  };

  return cachedConfig;
}

export function getSteamCMDExecutable(): string {
  const config = getConfig();
  // Windows: steamcmd.exe, Linux: steamcmd.sh
  const executable =
    process.platform === "win32" ? "steamcmd.exe" : "steamcmd.sh";
  return path.join(config.steamcmdPath, executable);
}
