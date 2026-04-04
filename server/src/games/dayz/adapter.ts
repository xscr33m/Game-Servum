/**
 * DayZ Game Adapter
 *
 * Handles all DayZ-specific server management logic:
 * - BattlEye RCON config reading
 * - serverDZ.cfg validation + BattlEye directory setup
 * - Mod handling: @ModName folders, .bikey key copying, -mod=/-serverMod= params
 * - Whitelist/ban via text files (BattlEye GUID format)
 * - ADM log parsing for player session backfill + character ID sync
 * - RPT crash log analysis
 */

import path from "path";
import fs from "fs";
import crypto from "crypto";
import { logger } from "../../core/logger.js";
import { updateCharacterIds, updateSteam64Ids } from "../../db/index.js";
import { recordPlayerConnect, recordPlayerDisconnect } from "../../db/index.js";
import { BaseGameAdapter } from "../base.js";
import type {
  GameDefinition,
  RconConfig,
  PlayerFileConfig,
  PlayerListResult,
  EditableFileConfig,
  BrowsableRoot,
  ModCopyResult,
  LogPaths,
  StartupDetector,
  BackupPathConfig,
} from "../types.js";
import type { GameServer } from "../../types/index.js";
import type { ServerMod } from "../../types/index.js";
import type { RconClient } from "../../core/rcon/types.js";
import { parseBattlEyePlayersResponse } from "../../core/rcon/battleye.js";

// ── Helpers ────────────────────────────────────────────────────────

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function generatePassword(length: number = 16): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  let password = "";
  for (let i = 0; i < length; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}

function resolveProfilesPath(server: GameServer): string {
  return path.isAbsolute(server.profilesPath)
    ? server.profilesPath
    : path.join(server.installPath, server.profilesPath);
}

/**
 * DayZ renames BEServer_x64.cfg to BEServer_x64_active_xxx.cfg at runtime.
 * After a non-graceful shutdown the original filename is never restored.
 * This helper finds the active variant so RCON config can still be read.
 */
function findActiveBEConfig(dir: string): string | null {
  try {
    const files = fs.readdirSync(dir);
    const active = files.find(
      (f) => f.startsWith("BEServer_x64") && f.endsWith(".cfg"),
    );
    return active ? path.join(dir, active) : null;
  } catch {
    return null;
  }
}

/**
 * Check whether any BattlEye config file exists in the given directory
 * (including the _active_ variant that DayZ creates at runtime).
 */
function hasBEConfig(dir: string): boolean {
  return findActiveBEConfig(dir) !== null;
}

// ── DayZ Adapter ───────────────────────────────────────────────────

export class DayZAdapter extends BaseGameAdapter {
  readonly definition: GameDefinition = {
    id: "dayz",
    name: "DayZ",
    logo: "dayz.png",
    appId: 223350,
    workshopAppId: 221100,
    executable: "DayZServer_x64.exe",
    defaultPort: 2302,
    portStride: 100,
    requiresLogin: true,
    defaultLaunchParams:
      "-config=serverDZ.cfg -port={PORT} -profiles={PROFILES} -doLogs -adminLog -netLog -freezeCheck",
    description:
      "Post-apocalyptic survival game. Requires Steam login to download.",
    configFiles: ["serverDZ.cfg", "profiles/", "mpmissions/"],
    firewallRules: [
      { portOffset: 0, portCount: 3, protocol: "UDP", description: "Game" },
      {
        portOffset: 3,
        portCount: 1,
        protocol: "UDP",
        description: "RCON (BattlEye)",
      },
      {
        portOffset: 24714,
        portCount: 1,
        protocol: "UDP",
        description: "Steam Query",
      },
    ],
    capabilities: {
      rcon: "battleye",
      workshopMods: true,
      configEditor: true,
      playerTracking: true,
      scheduledMessages: true,
      whitelist: "file",
      banList: "file",
      playerIdentifier: "battleye-guid",
      logParsing: true,
      playerListEditable: true,
      profilesPath: true,
      directMessage: true,
      priorityQueue: "file",
    },
    broadcastCommand: "say -1 {MESSAGE}",
    playerListCommand: "players",
  };

  // ── Lifecycle ────────────────────────────────────────────────────

  async postInstall(
    installPath: string,
    serverName: string,
    port: number,
  ): Promise<void> {
    logger.info(`[DayZ] Running post-install for ${serverName}...`);

    const profilesPath = path.join(installPath, "profiles");
    ensureDir(profilesPath);
    logger.info(`[DayZ] Created profiles directory: ${profilesPath}`);

    // Patch serverDZ.cfg
    const configPath = path.join(installPath, "serverDZ.cfg");
    if (fs.existsSync(configPath)) {
      let configContent = fs.readFileSync(configPath, "utf-8");
      configContent = configContent.replace(
        /^hostname\s*=\s*"[^"]*";/m,
        `hostname = "${serverName}";`,
      );
      configContent = configContent.replace(
        /^description\s*=\s*"[^"]*";/m,
        `description = "**Managed by Game-Servum**";`,
      );
      configContent = configContent.replace(
        /^passwordAdmin\s*=\s*"[^"]*";/m,
        `passwordAdmin = "${generatePassword(20)}";`,
      );
      fs.writeFileSync(configPath, configContent, "utf-8");
      logger.info(`[DayZ] Updated serverDZ.cfg with hostname: ${serverName}`);
    } else {
      logger.info(
        `[DayZ] Warning: serverDZ.cfg not found, will be created on first server start`,
      );
    }

    // Create BattlEye directory and config
    const battleEyePath = path.join(profilesPath, "BattlEye");
    ensureDir(battleEyePath);

    const beServerCfgPath = path.join(battleEyePath, "BEServer_x64.cfg");
    if (!fs.existsSync(beServerCfgPath)) {
      const rconPassword = generatePassword(20);
      const rconPort = port + 3;
      const beConfig = `RConPassword ${rconPassword}\nRConPort ${rconPort}\nRestrictRCon 0\n`;
      fs.writeFileSync(beServerCfgPath, beConfig, "utf-8");
      logger.info(`[DayZ] Created BattlEye config with secure RCon password`);
    }

    logger.info(`[DayZ] Post-install complete for ${serverName}`);
  }

  validatePreStart(server: GameServer): string[] {
    const errors = super.validatePreStart(server);

    // DayZ requires serverDZ.cfg
    const configPath = path.join(server.installPath, "serverDZ.cfg");
    if (!fs.existsSync(configPath)) {
      errors.push(
        "DayZ config file not found: serverDZ.cfg. Please ensure the server was installed correctly.",
      );
    }

    // Ensure BattlEye directory and config exist
    const resolvedProfiles = resolveProfilesPath(server);
    const battleEyePath = path.join(resolvedProfiles, "BattlEye");
    if (!fs.existsSync(battleEyePath)) {
      fs.mkdirSync(battleEyePath, { recursive: true });
      logger.info(`[DayZ] Created BattlEye directory: ${battleEyePath}`);
    }

    // Create default BattlEye config if no config file exists at all
    // (including _active_ variants that DayZ creates at runtime)
    if (!hasBEConfig(battleEyePath)) {
      const beConfigPath = path.join(battleEyePath, "BEServer_x64.cfg");
      const rconPort = server.port + 3;
      fs.writeFileSync(
        beConfigPath,
        `RConPassword ${generatePassword(20)}\nRConPort ${rconPort}\nRestrictRCon 0\n`,
        "utf-8",
      );
      logger.info(`[DayZ] Created default BattlEye config`);
    }

    return errors;
  }

  // ── RCON ─────────────────────────────────────────────────────────

  readRconConfig(server: GameServer): RconConfig | null {
    const resolvedProfiles = resolveProfilesPath(server);

    // Directories to check for BattlEye config (in priority order)
    const possibleDirs = [
      path.join(resolvedProfiles, "BattlEye"),
      path.join(server.installPath, "battleye"),
      path.join(server.installPath, "BattlEye"),
    ];

    for (const dir of possibleDirs) {
      if (!fs.existsSync(dir)) continue;

      // Try the standard filename first
      const standardPath = path.join(dir, "BEServer_x64.cfg");
      const configPath = fs.existsSync(standardPath)
        ? standardPath
        : findActiveBEConfig(dir);

      if (!configPath) continue;

      try {
        const content = fs.readFileSync(configPath, "utf-8");
        const passwordMatch = content.match(/^RConPassword\s+(.+)$/m);
        const portMatch = content.match(/^RConPort\s+(\d+)$/m);

        if (passwordMatch) {
          logger.debug(`[DayZ] Found BattlEye config: ${configPath}`);
          return {
            password: passwordMatch[1].trim(),
            port: portMatch ? parseInt(portMatch[1].trim(), 10) : 2305,
          };
        }
      } catch (error) {
        logger.error(
          `[DayZ] Error reading BattlEye config ${configPath}:`,
          error,
        );
      }
    }

    logger.debug(
      `[DayZ] No BattlEye config found in: ${possibleDirs.join(", ")}`,
    );
    return null;
  }

  async sendDirectMessage(
    rcon: RconClient,
    playerId: string,
    playerName: string,
    message: string,
  ): Promise<boolean> {
    // Resolve the player's current index from the BattlEye players list by name
    const response = await rcon.sendCommand("players");
    const players = parseBattlEyePlayersResponse(response);
    const player = players.find((p) => p.name === playerName);
    if (!player) return false;
    await rcon.sendCommand(`say ${player.index} ${message}`);
    return true;
  }

  // ── Mods ─────────────────────────────────────────────────────────

  async copyModToServer(
    mod: ServerMod,
    serverInstallPath: string,
    workshopContentPath: string,
  ): Promise<ModCopyResult> {
    // Use base copy first
    const result = await super.copyModToServer(
      mod,
      serverInstallPath,
      workshopContentPath,
    );
    if (!result.success) return result;

    const safeFolderName = (result.modName || mod.name)
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .substring(0, 50);
    const targetPath = path.join(serverInstallPath, `@${safeFolderName}`);

    // DayZ-specific: Create mod.cpp if missing
    const modCppPath = path.join(targetPath, "mod.cpp");
    if (!fs.existsSync(modCppPath)) {
      const modCppContent = `name = "${result.modName || mod.name}";\ndir = "@${safeFolderName}";\n`;
      fs.writeFileSync(modCppPath, modCppContent);
    }

    // DayZ-specific: Recursively find and copy .bikey files to server keys folder
    const keysTarget = path.join(serverInstallPath, "keys");
    const bikeyFiles: string[] = [];

    function findBikeys(dir: string): void {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findBikeys(fullPath);
        } else if (entry.name.endsWith(".bikey")) {
          bikeyFiles.push(fullPath);
        }
      }
    }

    findBikeys(targetPath);

    if (bikeyFiles.length > 0) {
      if (!fs.existsSync(keysTarget)) {
        fs.mkdirSync(keysTarget, { recursive: true });
      }
      for (const bikeyPath of bikeyFiles) {
        const fileName = path.basename(bikeyPath);
        fs.copyFileSync(bikeyPath, path.join(keysTarget, fileName));
      }
      logger.info(
        `[DayZ] Copied ${bikeyFiles.length} .bikey file(s) to keys/ for mod "${mod.name}"`,
      );
    }

    return result;
  }

  generateModLaunchParams(mods: ServerMod[]): {
    modParam: string;
    serverModParam: string;
  } {
    const enabledMods = mods.filter(
      (m) => m.enabled && m.status === "installed",
    );

    const clientMods = enabledMods
      .filter((m) => !m.isServerMod)
      .sort((a, b) => a.loadOrder - b.loadOrder)
      .map((m) => {
        const safeName = m.name
          .replace(/[^a-zA-Z0-9_-]/g, "_")
          .replace(/_+/g, "_")
          .substring(0, 50);
        return `@${safeName}`;
      });

    const serverMods = enabledMods
      .filter((m) => m.isServerMod)
      .sort((a, b) => a.loadOrder - b.loadOrder)
      .map((m) => {
        const safeName = m.name
          .replace(/[^a-zA-Z0-9_-]/g, "_")
          .replace(/_+/g, "_")
          .substring(0, 50);
        return `@${safeName}`;
      });

    return {
      modParam: clientMods.length > 0 ? `-mod=${clientMods.join(";")}` : "",
      serverModParam:
        serverMods.length > 0 ? `-serverMod=${serverMods.join(";")}` : "",
    };
  }

  // ── Player Management ────────────────────────────────────────────

  getWhitelistConfig(server: GameServer): PlayerFileConfig | null {
    return {
      filePath: path.join(server.installPath, "whitelist.txt"),
      idType: "battleye-guid",
    };
  }

  getBanListConfig(server: GameServer): PlayerFileConfig | null {
    return {
      filePath: path.join(server.installPath, "ban.txt"),
      idType: "battleye-guid",
    };
  }

  getPriorityConfig(server: GameServer): PlayerFileConfig | null {
    return {
      filePath: path.join(server.installPath, "priority.txt"),
      idType: "steam-id",
    };
  }

  formatPlayerEntry(
    type: "whitelist" | "ban" | "priority",
    playerId: string,
    playerName?: string,
  ): string {
    if (!playerName) return playerId;
    // Priority queue stores only Steam IDs (no comments)
    if (type === "priority") return playerId;
    // DayZ whitelist uses tab separator, ban uses space
    return type === "whitelist"
      ? `${playerId}\t//${playerName}`
      : `${playerId} //${playerName}`;
  }

  parsePlayerEntry(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) return null;
    // Extract the ID (everything before tab or space+//)
    const id = trimmed.split(/\t|(\s+\/\/)/)[0].trim();
    return id || null;
  }

  /**
   * Priority queue uses semicolon-separated Steam IDs on a single line.
   * Override to add a Steam ID to the semicolon list.
   */
  addToPlayerList(
    server: GameServer,
    type: "whitelist" | "ban" | "priority",
    playerId: string,
    playerName?: string,
  ): PlayerListResult {
    if (type !== "priority") {
      return super.addToPlayerList(server, type, playerId, playerName);
    }

    const config = this.getPriorityConfig(server);
    if (!config) {
      return {
        success: false,
        message: "This game does not support priority queue",
      };
    }

    let content = "";
    if (fs.existsSync(config.filePath)) {
      content = fs.readFileSync(config.filePath, "utf-8").trim();
    }

    const ids = content
      ? content
          .split(";")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];

    if (ids.includes(playerId)) {
      return {
        success: false,
        message: "Player is already on the priority queue",
      };
    }

    ids.push(playerId);
    fs.writeFileSync(config.filePath, ids.join(";"), "utf-8");
    return {
      success: true,
      message: `${playerName || "Player"} added to priority queue`,
    };
  }

  /**
   * Remove a Steam ID from the semicolon-separated priority queue.
   */
  removeFromPlayerList(
    server: GameServer,
    type: "whitelist" | "ban" | "priority",
    playerId: string,
  ): PlayerListResult {
    if (type !== "priority") {
      return super.removeFromPlayerList(server, type, playerId);
    }

    const config = this.getPriorityConfig(server);
    if (!config) {
      return {
        success: false,
        message: "This game does not support priority queue",
      };
    }

    if (!fs.existsSync(config.filePath)) {
      return { success: false, message: "Priority file not found" };
    }

    const content = fs.readFileSync(config.filePath, "utf-8").trim();
    const ids = content
      ? content
          .split(";")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];
    const filtered = ids.filter((id) => id !== playerId);

    if (ids.length === filtered.length) {
      return {
        success: false,
        message: "Player not found on the priority queue",
      };
    }

    fs.writeFileSync(config.filePath, filtered.join(";"), "utf-8");
    return { success: true, message: "Player removed from priority queue" };
  }

  /**
   * Return priority queue content as one Steam ID per line (for frontend display).
   * The file stores IDs as semicolon-separated on one line.
   */
  getPlayerListContent(
    server: GameServer,
    type: "whitelist" | "ban" | "priority",
  ): string {
    if (type !== "priority") {
      return super.getPlayerListContent(server, type);
    }

    const config = this.getPriorityConfig(server);
    if (!config || !fs.existsSync(config.filePath)) return "";

    const content = fs.readFileSync(config.filePath, "utf-8").trim();
    if (!content) return "";

    // Convert semicolons to newlines for the frontend
    return content
      .split(";")
      .map((id) => id.trim())
      .filter(Boolean)
      .join("\n");
  }

  // ── Logs ─────────────────────────────────────────────────────────

  getLogFileExtensions(): string[] {
    return [".ADM", ".RPT", ".log"];
  }

  getShutdownCommands(): {
    commands: string[];
    delayBetweenMs?: number;
  } | null {
    return { commands: ["#shutdown"] };
  }

  getStartupDetector(server: GameServer): StartupDetector | null {
    const profilesDir = resolveProfilesPath(server);
    // DayZ writes script logs with timestamped filenames (script_YYYY-MM-DD_HH-MM-SS.log).
    // Use a relative glob; the polling code resolves the newest matching file.
    const relProfiles = path.relative(server.installPath, profilesDir);
    return {
      type: "logfile",
      pattern: "\\[MissionServer\\] OnMissionStart",
      logFile: path.join(relProfiles, "script_*.log"),
      timeoutMs: 120_000,
    };
  }

  getLogPaths(server: GameServer): LogPaths {
    const profilesDir = resolveProfilesPath(server);
    return {
      directories: [profilesDir],
      extensions: this.getLogFileExtensions(),
      archiveDir: path.join(profilesDir, "log_archive"),
    };
  }

  getEditableFiles(server: GameServer): EditableFileConfig[] {
    const resolvedProfiles = resolveProfilesPath(server);
    return [
      { name: "ban.txt", path: path.join(server.installPath, "ban.txt") },
      {
        name: "whitelist.txt",
        path: path.join(server.installPath, "whitelist.txt"),
      },
      {
        name: "priority.txt",
        path: path.join(server.installPath, "priority.txt"),
      },
      {
        name: "BEServer_x64.cfg",
        path: path.join(resolvedProfiles, "BattlEye", "BEServer_x64.cfg"),
        readonly: true,
      },
    ];
  }

  getBrowsableRoots(server: GameServer): BrowsableRoot[] {
    return [
      ...super.getBrowsableRoots(server),
      {
        key: "profiles",
        label: "Profiles",
        resolvePath: (s: GameServer) => resolveProfilesPath(s),
      },
      {
        key: "mpmissions",
        label: "MPMissions",
        resolvePath: (s: GameServer) => path.join(s.installPath, "mpmissions"),
      },
    ];
  }

  // ── DayZ-Specific: Log Parsing ───────────────────────────────────

  parseServerLogs(serverId: number, installPath: string): void {
    const profilesPath = path.join(installPath, "profiles");
    if (!fs.existsSync(profilesPath)) return;

    const admFile = this.findLatestAdmFile(profilesPath);
    if (!admFile) return;

    try {
      const content = fs.readFileSync(admFile, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      logger.info(
        `[DayZ] Backfilling from ${path.basename(admFile)} (${lines.length} lines)`,
      );

      let connectCount = 0;
      let disconnectCount = 0;

      for (const line of lines) {
        const connectMatch = line.match(
          /Player "(.+?)"\s*\(id=([^)\s]+)\)\s*is connected/,
        );
        if (connectMatch) {
          const characterId = connectMatch[2];
          recordPlayerConnect(
            serverId,
            characterId,
            connectMatch[1],
            undefined,
            characterId,
          );
          connectCount++;
          continue;
        }

        const disconnectMatch = line.match(
          /Player "(.+?)"\s*\(id=([^)\s]+)\)\s*has been disconnected/,
        );
        if (disconnectMatch) {
          recordPlayerDisconnect(serverId, disconnectMatch[2]);
          disconnectCount++;
        }
      }

      if (connectCount > 0 || disconnectCount > 0) {
        logger.info(
          `[DayZ] Backfill complete: ${connectCount} connects, ${disconnectCount} disconnects`,
        );
      }
    } catch (error) {
      logger.debug(
        `[DayZ] Could not read ADM log (may be locked): ${(error as Error).message}`,
      );
    }
  }

  syncPlayerDataFromLogs(serverId: number, installPath: string): void {
    const profilesPath = path.join(installPath, "profiles");

    // Sync character IDs from ADM logs
    const charMappings = this.extractPlayerMappingsFromLogs(installPath);
    if (charMappings.size > 0) {
      const updated = updateCharacterIds(serverId, charMappings);
      if (updated > 0) {
        logger.info(
          `[DayZ] Synced ${updated} character IDs from ADM log for server ${serverId}`,
        );
      }
    }

    // Sync Steam64 IDs from RPT logs
    const steam64Mappings = this.extractSteam64MappingsFromLogs(profilesPath);
    if (steam64Mappings.size > 0) {
      const updated = updateSteam64Ids(serverId, steam64Mappings);
      if (updated > 0) {
        logger.info(
          `[DayZ] Synced ${updated} Steam64 IDs from RPT log for server ${serverId}`,
        );
      }
    }
  }

  extractPlayerMappingsFromLogs(installPath: string): Map<string, string> {
    const mappings = new Map<string, string>();
    const profilesPath = path.join(installPath, "profiles");
    if (!fs.existsSync(profilesPath)) return mappings;

    const admFile = this.findLatestAdmFile(profilesPath);
    if (!admFile) return mappings;

    try {
      const content = fs.readFileSync(admFile, "utf-8");
      const lines = content.split("\n");

      for (const line of lines) {
        const match = line.match(/Player "(.+?)"\s*\(id=([A-Za-z0-9+/=]{20,})/);
        if (match) {
          mappings.set(match[1], match[2]);
        }
      }
    } catch {
      // File may be locked — expected during server runtime
    }

    return mappings;
  }

  // ── DayZ-Specific: Crash Analysis ────────────────────────────────

  analyzeCrash(_server: GameServer, profilesPath: string): string | null {
    try {
      if (!fs.existsSync(profilesPath)) {
        return "Profiles directory not found";
      }

      const files = fs.readdirSync(profilesPath);
      const rptFiles = files
        .filter((f) => f.toLowerCase().endsWith(".rpt"))
        .map((f) => ({
          name: f,
          path: path.join(profilesPath, f),
          mtime: fs.statSync(path.join(profilesPath, f)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      if (rptFiles.length === 0) {
        const consoleLogPath = path.join(profilesPath, "server_console.log");
        if (fs.existsSync(consoleLogPath)) {
          const content = fs.readFileSync(consoleLogPath, "utf-8");
          const lines = content.split("\n").filter((l) => l.trim());
          return lines.slice(-5).join(" | ").substring(0, 300);
        }
        return "No log files found";
      }

      const latestRpt = rptFiles[0];
      const content = fs.readFileSync(latestRpt.path, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      const errorLines = lines.filter(
        (l) =>
          l.toLowerCase().includes("error") ||
          l.toLowerCase().includes("failed") ||
          l.toLowerCase().includes("exception") ||
          l.toLowerCase().includes("cannot"),
      );

      if (errorLines.length > 0) {
        return errorLines.slice(-3).join(" | ").substring(0, 300);
      }

      return lines.slice(-3).join(" | ").substring(0, 300);
    } catch (error) {
      logger.error("[DayZ] Error reading crash logs:", error);
      return null;
    }
  }

  // ── Backup ──────────────────────────────────────────────────────

  getBackupPaths(server: GameServer): BackupPathConfig {
    const profilesRel = path.isAbsolute(server.profilesPath)
      ? path.relative(server.installPath, server.profilesPath)
      : server.profilesPath;
    return {
      savePaths: ["mpmissions"],
      configPaths: [profilesRel, "serverDZ.cfg"],
      excludePatterns: [
        "**/*.ADM",
        "**/*.RPT",
        "**/*.log",
        "**/log_archive/**",
        "**/BattlEye/BEServer_x64_active_*",
      ],
    };
  }

  // ── Private Helpers ──────────────────────────────────────────────

  private findLatestAdmFile(profilesPath: string): string | null {
    try {
      const files = fs
        .readdirSync(profilesPath)
        .filter((f) => f.endsWith(".ADM"));
      if (files.length === 0) return null;
      files.sort();
      return path.join(profilesPath, files[files.length - 1]);
    } catch {
      return null;
    }
  }

  private findLatestRptFile(profilesPath: string): string | null {
    try {
      const files = fs
        .readdirSync(profilesPath)
        .filter((f) => f.toLowerCase().endsWith(".rpt"));
      if (files.length === 0) return null;
      files.sort();
      return path.join(profilesPath, files[files.length - 1]);
    } catch {
      return null;
    }
  }

  /**
   * Extract player name → Steam64 ID mappings from RPT log files.
   * RPT lines contain: Player "Name"(steamID=76561198012345678) is connected
   */
  private extractSteam64MappingsFromLogs(
    profilesPath: string,
  ): Map<string, string> {
    const mappings = new Map<string, string>();
    if (!fs.existsSync(profilesPath)) return mappings;

    const rptFile = this.findLatestRptFile(profilesPath);
    if (!rptFile) return mappings;

    try {
      const content = fs.readFileSync(rptFile, "utf-8");
      const lines = content.split("\n");

      for (const line of lines) {
        const match = line.match(
          /Player "(.+?)"\(steamID=(\d+)\) is connected/,
        );
        if (match) {
          mappings.set(match[1], match[2]);
        }
      }
    } catch {
      // File may be locked — expected during server runtime
    }

    return mappings;
  }
}
