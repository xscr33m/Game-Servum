/**
 * Game Adapter Types
 *
 * Defines the contract all game adapters must implement.
 * Each game (DayZ, ARK, 7DTD) provides an adapter that encapsulates
 * all game-specific logic: post-install, RCON config, mod handling,
 * player list management, log parsing, and crash analysis.
 */

import type {
  GameCapabilities,
  FirewallRuleDefinition,
  GameMetadata,
  StartupDetector,
} from "@game-servum/shared";
import type { GameServer } from "../types/index.js";
import type { ServerMod } from "../types/index.js";

export type { GameMetadata, StartupDetector };

// ── Game Definition (static metadata) ────────────────────────────────

export interface GameDefinition {
  id: string;
  name: string;
  /** Logo filename relative to game-logos/ (e.g. "dayz.png") */
  logo: string;
  appId: number;
  workshopAppId?: number;
  executable: string;
  defaultPort: number;
  portStride?: number;
  requiresLogin: boolean;
  defaultLaunchParams: string;
  description: string;
  configFiles?: string[];
  firewallRules?: FirewallRuleDefinition[];
  capabilities: GameCapabilities;
  broadcastCommand?: string;
  playerListCommand?: string;
  /** Regex pattern matched against server log output to detect startup completion.
   *  When matched, RCON connection is triggered. If not set, uses a fixed delay. */
  startupCompletePattern?: string;
  /** Relative path (from installPath) to the log file to watch for startupCompletePattern.
   *  If not set, only stdout is checked. */
  startupLogFile?: string;
}

// ── RCON Config ──────────────────────────────────────────────────────

export interface RconConfig {
  password: string;
  port: number;
}

// ── Player List File Config ──────────────────────────────────────────

export interface PlayerFileConfig {
  /** Absolute path to the file */
  filePath: string;
  /** How player IDs are stored ("battleye-guid" or "steam-id") */
  idType: "battleye-guid" | "steam-id";
}

// ── Browsable Root Config ─────────────────────────────────────────────

export interface BrowsableRoot {
  /** Unique key used in API requests (e.g., "profiles") */
  key: string;
  /** Human-readable label for the UI */
  label: string;
  /** Resolve the absolute path on disk for a given server */
  resolvePath: (server: GameServer) => string;
}

// ── Editable File Config ─────────────────────────────────────────────

export interface EditableFileConfig {
  /** Identifier used in API requests (e.g., "ban.txt", "BEServer_x64.cfg") */
  name: string;
  /** Absolute path to the file on disk */
  path: string;
  /** If true, file can be read but not written via API */
  readonly?: boolean;
}

// ── Log Paths Config ─────────────────────────────────────────────────

export interface LogPaths {
  /** Directories to scan for log files (may contain multiple) */
  directories: string[];
  /** File extensions to match (e.g., [".ADM", ".RPT", ".log"] or [".txt"]) */
  extensions: string[];
  /** Directory where archived log sessions are stored */
  archiveDir: string;
}

// ── Player List Operation Result ─────────────────────────────────────

export interface PlayerListResult {
  success: boolean;
  message: string;
}

// ── Mod Copy Result ──────────────────────────────────────────────────

export interface ModCopyResult {
  success: boolean;
  message: string;
  modName?: string;
}

// ── GameAdapter Interface ────────────────────────────────────────────

export interface GameAdapter {
  /** Static game definition (metadata, ports, capabilities, etc.) */
  readonly definition: GameDefinition;

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Run post-install setup after SteamCMD installs the server.
   * Examples: create config files, patch defaults, create directories.
   */
  postInstall(
    installPath: string,
    serverName: string,
    port: number,
  ): Promise<void>;

  /**
   * Validate server state before starting. Return error messages or empty array if OK.
   * Examples: check config file exists, ensure BattlEye dir, create defaults.
   */
  validatePreStart(server: GameServer): string[];

  // ── RCON ─────────────────────────────────────────────────────────

  /**
   * Read RCON connection config from server files or launch params.
   * Returns null if RCON is not available or config cannot be determined.
   */
  readRconConfig(server: GameServer): RconConfig | null;

  // ── Mods ─────────────────────────────────────────────────────────

  /**
   * Copy a downloaded Workshop mod into the correct server directory.
   * Called after SteamCMD finishes downloading.
   * Default: generic copy to @ModName directory.
   */
  copyModToServer(
    mod: ServerMod,
    serverInstallPath: string,
    workshopContentPath: string,
  ): Promise<ModCopyResult>;

  /**
   * Remove a mod from the server directory.
   * Default: removes @ModName folder matching mod's workshop ID via meta.cpp.
   * Games with different mod structures (ARK Content/Mods/) override this.
   */
  uninstallMod(
    mod: ServerMod,
    serverInstallPath: string,
  ): Promise<ModCopyResult>;

  /**
   * Generate launch parameter strings for active mods.
   * Returns { modParam, serverModParam } for appending to launch command.
   */
  generateModLaunchParams(mods: ServerMod[]): {
    modParam: string;
    serverModParam: string;
  };

  // ── Player Management ────────────────────────────────────────────

  /**
   * Get whitelist file config, or null if not supported / not file-based.
   */
  getWhitelistConfig(server: GameServer): PlayerFileConfig | null;

  /**
   * Get ban list file config, or null if not supported / not file-based.
   */
  getBanListConfig(server: GameServer): PlayerFileConfig | null;

  /**
   * Format a player entry for writing to whitelist/ban file.
   * Returns the line to append.
   */
  formatPlayerEntry(
    type: "whitelist" | "ban",
    playerId: string,
    playerName?: string,
  ): string;

  /**
   * Parse a player ID from a line in a whitelist/ban file.
   * Returns the player ID or null if line doesn't match.
   */
  parsePlayerEntry(line: string): string | null;

  /**
   * Add a player to a whitelist or ban list.
   * Default: appends a text line to the file from getWhitelistConfig/getBanListConfig.
   * Games with XML configs (7DTD) override this.
   */
  addToPlayerList(
    server: GameServer,
    type: "whitelist" | "ban",
    playerId: string,
    playerName?: string,
  ): PlayerListResult;

  /**
   * Remove a player from a whitelist or ban list.
   * Default: removes matching lines from the text file.
   * Games with XML configs (7DTD) override this.
   */
  removeFromPlayerList(
    server: GameServer,
    type: "whitelist" | "ban",
    playerId: string,
  ): PlayerListResult;

  /**
   * Get the player list content as a simple text representation
   * (one player ID per line) for status badge checks in the frontend.
   * Games with XML configs (7DTD) override to extract IDs from XML.
   */
  getPlayerListContent(server: GameServer, type: "whitelist" | "ban"): string;

  // ── Logs ─────────────────────────────────────────────────────────

  /**
   * File extensions to archive when rotating logs (e.g. [".ADM", ".RPT", ".log"]).
   */
  getLogFileExtensions(): string[];

  /**
   * Return the directories to scan for logs, file extensions to match,
   * and where to store archived log sessions.
   */
  getLogPaths(server: GameServer): LogPaths;

  /**
   * List of files that the frontend may read/edit via the files API.
   * Includes resolved paths and read-only flags.
   */
  getEditableFiles(server: GameServer): EditableFileConfig[];

  /**
   * Directories the frontend may browse and edit files in via the browse API.
   * Each root defines a key, label, and path resolver.
   */
  getBrowsableRoots(server: GameServer): BrowsableRoot[];

  /**
   * Extra environment variables required when spawning the server process.
   * Merged into the parent environment before spawn.
   * Example: 7DTD needs SteamAppId=251570 for Steam networking.
   */
  getSpawnEnvironment(server: GameServer): Record<string, string>;

  /**
   * Return startup detection config, or null to use a fixed delay.
   * Replaces the hardcoded startupCompletePattern/startupLogFile in GameDefinition.
   * Receives the server so adapters can compute per-server paths (e.g. profilesPath).
   */
  getStartupDetector(server: GameServer): StartupDetector | null;

  /**
   * Return game metadata for the frontend (name, logo, description).
   */
  getMetadata(): GameMetadata;

  /**
   * Return additional launch parameters to append before spawning.
   * Used to inject RCON credentials into the command line so the server
   * picks them up even if it overwrites config files on first start (e.g. ARK).
   */
  getAdditionalLaunchParams?(server: GameServer): string;

  // ── Shutdown ─────────────────────────────────────────────────────

  /**
   * Return RCON commands to send for a graceful server shutdown.
   * Commands are sent in order before the process is terminated.
   * Returns null if no RCON-based shutdown is supported.
   */
  getShutdownCommands(): { commands: string[]; delayBetweenMs?: number } | null;

  // ── Optional: Game-Specific Features ─────────────────────────────

  /**
   * Parse game-specific server logs to backfill player history.
   * Only some games support this (e.g. DayZ ADM logs).
   */
  parseServerLogs?(serverId: number, installPath: string): void;

  /**
   * Periodically sync extra player data from logs (e.g. DayZ character IDs).
   * Called during RCON polling loop.
   */
  syncPlayerDataFromLogs?(serverId: number, installPath: string): void;

  /**
   * Extract player identity mappings from logs.
   * Returns Map of playerName → characterId.
   */
  extractPlayerMappingsFromLogs?(installPath: string): Map<string, string>;

  /**
   * Read crash logs and return a human-readable summary, or null.
   */
  analyzeCrash?(server: GameServer, profilesPath: string): string | null;

  /**
   * Correct player names from RCON using a more reliable source (e.g. log files).
   * ARK RCON replaces non-ASCII characters with '?'; the log file preserves them.
   * Mutates the map in-place, replacing names where a better source is available.
   */
  resolvePlayerNames?(
    steamIdToName: Map<string, string>,
    installPath: string,
  ): void;

  /**
   * Update game-specific config file after mod list changes.
   * E.g. ARK writes ActiveMods= into GameUserSettings.ini.
   */
  updateActiveModsInConfig?(serverInstallPath: string, mods: ServerMod[]): void;

  /**
   * Check whether the game has generated its config files.
   * Used by games like ARK where the server creates configs on first start.
   * Returns true if config files exist and are non-trivial.
   */
  isConfigGenerated?(server: GameServer): boolean;

  /**
   * Write initial settings (from launch params) into game-generated config files.
   * Called after the first successful server start once configs exist.
   */
  writeInitialSettingsToConfig?(server: GameServer): void;
}
