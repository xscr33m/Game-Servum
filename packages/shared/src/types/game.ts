/**
 * Game Module Types
 *
 * Types for the modular game plugin system. Each game module (DayZ, ARK, 7DTD)
 * provides metadata and capabilities that drive both backend and frontend behavior.
 */

// ── Game Metadata (served from backend to frontend) ────────────────

/** Static metadata about a supported game, sent via the games list API */
export interface GameMetadata {
  /** Unique game identifier (e.g. "dayz", "ark", "7dtd") */
  id: string;
  /** Human-readable game name (e.g. "DayZ", "ARK: Survival Evolved") */
  name: string;
  /** Logo filename relative to game-logos/ (e.g. "dayz.png") */
  logo: string;
  /** Brief description of the game */
  description: string;
}

// ── Startup Detection ──────────────────────────────────────────────

/** How the system detects that a game server has finished starting */
export interface StartupDetector {
  /** Where to watch for the pattern: 'stdout' = process output, 'logfile' = a file on disk */
  type: "stdout" | "logfile";
  /** Regex pattern string to match against output (serialized for transport) */
  pattern: string;
  /** Relative path from installPath to the log file (required when type is 'logfile') */
  logFile?: string;
  /** How long to wait for startup before giving up (ms, default: 120000) */
  timeoutMs?: number;
}
