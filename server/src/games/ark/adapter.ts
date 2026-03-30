/**
 * ARK: Survival Evolved Game Adapter
 *
 * Handles all ARK-specific server management logic:
 * - Source RCON config from GameUserSettings.ini (RCONPort, ServerAdminPassword)
 * - GameUserSettings.ini / Game.ini config editor
 * - Workshop mods via -automanagedmods + ActiveMods in GameUserSettings.ini
 * - Whitelist via PlayersJoinNoCheckList.txt / Ban via BannedPlayers.txt
 */

import path from "path";
import fs from "fs";
import crypto from "crypto";
import { logger } from "../../index.js";
import { recordPlayerConnect, recordPlayerDisconnect } from "../../db/index.js";
import {
  BaseGameAdapter,
  getQueryPortOffset,
  getRconPortOffset,
} from "../base.js";
import { readGameFile } from "../encoding.js";
import type {
  GameDefinition,
  RconConfig,
  PlayerFileConfig,
  EditableFileConfig,
  ModCopyResult,
  LogPaths,
  StartupDetector,
  BackupPathConfig,
} from "../types.js";
import type { GameServer } from "../../types/index.js";
import type { ServerMod } from "../../types/index.js";

// ── Helpers ────────────────────────────────────────────────────────

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

/**
 * Set or append a key=value pair under a specific [Section] in an INI file.
 * If the key exists under the section, its value is replaced.
 * If the key does not exist, it is appended at the end of the section.
 * If the section does not exist, both section and key are appended.
 */
function setIniProperty(
  content: string,
  section: string,
  key: string,
  value: string,
): string {
  const lines = content.split("\n");
  const sectionHeader = `[${section}]`;
  let sectionStart = -1;
  let sectionEnd = lines.length;

  // Find the section
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === sectionHeader.toLowerCase()) {
      sectionStart = i;
      // Find end of section (next [Section] or EOF)
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim().startsWith("[")) {
          sectionEnd = j;
          break;
        }
      }
      break;
    }
  }

  if (sectionStart === -1) {
    // Section not found — append it
    const newLines = content.endsWith("\n") ? [] : [""];
    newLines.push(sectionHeader, `${key}=${value}`);
    return content + newLines.join("\n") + "\n";
  }

  // Look for existing key in section
  const keyLower = key.toLowerCase();
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const eqIdx = lines[i].indexOf("=");
    if (eqIdx > 0) {
      const existingKey = lines[i].substring(0, eqIdx).trim();
      if (existingKey.toLowerCase() === keyLower) {
        lines[i] = `${key}=${value}`;
        return lines.join("\n");
      }
    }
  }

  // Key not found in section — insert before section end
  lines.splice(sectionEnd, 0, `${key}=${value}`);
  return lines.join("\n");
}

/**
 * Read an INI property value from a specific section.
 */
function getIniProperty(
  content: string,
  section: string,
  key: string,
): string | null {
  const lines = content.split("\n");
  const sectionHeader = `[${section}]`;
  let inSection = false;
  const keyLower = key.toLowerCase();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === sectionHeader.toLowerCase()) {
      inSection = true;
      continue;
    }
    if (trimmed.startsWith("[")) {
      if (inSection) break;
      continue;
    }
    if (inSection) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const existingKey = trimmed.substring(0, eqIdx).trim();
        if (existingKey.toLowerCase() === keyLower) {
          return trimmed.substring(eqIdx + 1).trim();
        }
      }
    }
  }
  return null;
}

// ── ARK Adapter ────────────────────────────────────────────────────

export class ArkAdapter extends BaseGameAdapter {
  readonly definition: GameDefinition = {
    id: "ark",
    name: "ARK: Survival Evolved",
    logo: "ark.png",
    appId: 376030,
    workshopAppId: 346110, // ARK Workshop mods are under the game AppID (346110), not the server (376030)
    executable: "ShooterGame/Binaries/Win64/ShooterGameServer.exe",
    defaultPort: 7777,
    portStride: 2,
    requiresLogin: false,
    defaultLaunchParams:
      "TheIsland?listen?SessionName={SERVER_NAME}?Port={PORT}?QueryPort={QUERY_PORT}?RCONEnabled=True -servergamelog -log -forcelogflush",
    description: "Dinosaur survival game. Can be downloaded anonymously.",
    configFiles: [
      "ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini",
      "ShooterGame/Saved/Config/WindowsServer/Game.ini",
    ],
    firewallRules: [
      {
        portOffset: 0,
        portCount: 2,
        protocol: "UDP",
        description: "Game + Peer",
      },
      {
        portOffset: 19238,
        portCount: 1,
        protocol: "UDP",
        description: "Steam Query",
      },
      { portOffset: 19243, portCount: 1, protocol: "TCP", description: "RCON" },
    ],
    capabilities: {
      rcon: "source",
      workshopMods: true,
      configEditor: true,
      playerTracking: true,
      scheduledMessages: true,
      whitelist: "file",
      banList: "file",
      playerIdentifier: "steam-id",
      logParsing: true,
      playerListEditable: true,
      profilesPath: false,
      directMessage: false,
    },
    broadcastCommand: "ServerChat {MESSAGE}",
    playerListCommand: "ListPlayers",
    startupCompletePattern: "Full Startup: .+ seconds",
    startupLogFile: "ShooterGame/Saved/Logs/ShooterGame.log",
  };

  // Cache of SteamID → correct player name extracted from ShooterGame.log
  // ARK RCON replaces non-ASCII characters with '?'; the log preserves them.
  private playerNameCache = new Map<string, string>();
  private nameCacheLastRefresh = 0;
  private static readonly NAME_CACHE_TTL_MS = 60_000; // Re-read log at most once per minute

  getShutdownCommands(): {
    commands: string[];
    delayBetweenMs?: number;
  } | null {
    return { commands: ["saveworld", "doexit"], delayBetweenMs: 3000 };
  }

  getStartupDetector(_server: GameServer): StartupDetector | null {
    return {
      type: "logfile",
      pattern: "has successfully started",
      logFile: "ShooterGame/Saved/Logs/ShooterGame.log",
      timeoutMs: 900_000, // ARK can take 10+ minutes to start
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async postInstall(
    installPath: string,
    serverName: string,
    _port: number,
  ): Promise<void> {
    logger.info(`[ARK] Running post-install for ${serverName}...`);

    // ARK needs ShooterGame/Saved directory structure.
    // Do NOT create config files — ARK generates them on first start.
    // The user configures initial settings (name, password, etc.) via the
    // Initial-Settings UI, which stores them as launch parameters.
    const savedConfigPath = path.join(
      installPath,
      "ShooterGame",
      "Saved",
      "Config",
      "WindowsServer",
    );
    if (!fs.existsSync(savedConfigPath)) {
      fs.mkdirSync(savedConfigPath, { recursive: true });
    }

    // Ensure Logs directory exists (ARK writes to ShooterGame/Saved/Logs/)
    const logsPath = path.join(installPath, "ShooterGame", "Saved", "Logs");
    if (!fs.existsSync(logsPath)) {
      fs.mkdirSync(logsPath, { recursive: true });
    }

    logger.info(
      `[ARK] Post-install complete for ${serverName} (directories only, no config files)`,
    );
  }

  validatePreStart(server: GameServer): string[] {
    const errors: string[] = [];

    // Check executable
    const executablePath = path.join(server.installPath, server.executable);
    if (!fs.existsSync(executablePath)) {
      errors.push(`Server executable not found: ${server.executable}`);
    }

    // If config already exists, ensure RCON settings are present.
    // Before first start (no INI), RCON is injected via launch params instead.
    if (this.isConfigGenerated(server)) {
      this.ensureRconConfig(server);
    }

    return errors;
  }

  // ── Config Lifecycle ─────────────────────────────────────────────

  /**
   * Check whether ARK has generated its config files (after first full start).
   * Returns true if GameUserSettings.ini exists and is non-trivial (>100 bytes).
   */
  isConfigGenerated(server: GameServer): boolean {
    const gusPath = path.join(
      server.installPath,
      "ShooterGame",
      "Saved",
      "Config",
      "WindowsServer",
      "GameUserSettings.ini",
    );
    try {
      if (!fs.existsSync(gusPath)) return false;
      const stat = fs.statSync(gusPath);
      return stat.size > 100;
    } catch {
      return false;
    }
  }

  /**
   * Write initial settings into ARK-generated config files.
   * Called after the first full server start (World Save Complete),
   * once ARK has created its own GameUserSettings.ini.
   * Reads values from launch params and writes them into the INI.
   */
  writeInitialSettingsToConfig(server: GameServer): void {
    const gusPath = path.join(
      server.installPath,
      "ShooterGame",
      "Saved",
      "Config",
      "WindowsServer",
      "GameUserSettings.ini",
    );

    if (!fs.existsSync(gusPath)) {
      logger.warn(
        `[ARK] Cannot write initial settings: GameUserSettings.ini not found`,
      );
      return;
    }

    try {
      let content = readGameFile(gusPath);
      const rconPort =
        server.port + (getRconPortOffset(this.definition) || 19243);
      const queryPort =
        server.queryPort ??
        server.port + (getQueryPortOffset(this.definition) || 19238);

      // Resolve placeholders in launch params so we extract real values,
      // not template variables like {SERVER_NAME} or {PORT}
      const launchParams = (server.launchParams || "")
        .replace(/\{SERVER_NAME\}/g, server.name)
        .replace(/\{PORT\}/g, String(server.port))
        .replace(/\{QUERY_PORT\}/g, String(queryPort))
        .replace(/\{INSTALL_PATH\}/g, server.installPath)
        .replace(/\{PROFILES\}/g, server.profilesPath);

      // Extract values from launch params (set by Initial-Settings UI)
      const sessionName =
        this.extractLaunchParam(launchParams, "SessionName") ||
        server.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      const adminPassword =
        this.extractLaunchParam(launchParams, "ServerAdminPassword") ||
        generatePassword(20);
      const serverPassword =
        this.extractLaunchParam(launchParams, "ServerPassword") || "";
      const maxPlayers =
        this.extractLaunchParam(launchParams, "MaxPlayers") || "70";
      const rconPortStr =
        this.extractLaunchParam(launchParams, "RCONPort") || String(rconPort);

      // Write into [ServerSettings]
      content = setIniProperty(
        content,
        "ServerSettings",
        "SessionName",
        sessionName,
      );
      content = setIniProperty(
        content,
        "ServerSettings",
        "ServerAdminPassword",
        adminPassword,
      );
      content = setIniProperty(
        content,
        "ServerSettings",
        "ServerPassword",
        serverPassword,
      );
      content = setIniProperty(
        content,
        "ServerSettings",
        "RCONEnabled",
        "True",
      );
      content = setIniProperty(
        content,
        "ServerSettings",
        "RCONPort",
        rconPortStr,
      );
      content = setIniProperty(
        content,
        "ServerSettings",
        "Port",
        String(server.port),
      );
      content = setIniProperty(
        content,
        "ServerSettings",
        "QueryPort",
        String(queryPort),
      );

      // Write into [SessionSettings]
      content = setIniProperty(
        content,
        "SessionSettings",
        "SessionName",
        sessionName,
      );

      // Write into [/Script/Engine.GameSession]
      content = setIniProperty(
        content,
        "/Script/Engine.GameSession",
        "MaxPlayers",
        maxPlayers,
      );

      fs.writeFileSync(gusPath, content, "utf-8");
      logger.info(
        `[ARK] Wrote initial settings to GameUserSettings.ini: SessionName=${sessionName}, RCONPort=${rconPortStr}, MaxPlayers=${maxPlayers}`,
      );
    } catch (err) {
      logger.error(`[ARK] Failed to write initial settings to config:`, err);
    }
  }

  /**
   * Extract a ?Key=Value parameter from an ARK-style launch param string.
   */
  private extractLaunchParam(launchParams: string, key: string): string | null {
    const regex = new RegExp(`[?]${key}=([^?\\s]+)`, "i");
    const match = launchParams.match(regex);
    return match ? match[1] : null;
  }

  /**
   * Ensure RCON-critical keys exist in GameUserSettings.ini.
   * Called before every server start via validatePreStart().
   */
  private ensureRconConfig(server: GameServer): void {
    const gusPath = path.join(
      server.installPath,
      "ShooterGame",
      "Saved",
      "Config",
      "WindowsServer",
      "GameUserSettings.ini",
    );
    if (!fs.existsSync(gusPath)) return;

    try {
      let content = readGameFile(gusPath);
      let modified = false;

      const existingPassword = getIniProperty(
        content,
        "ServerSettings",
        "ServerAdminPassword",
      );
      if (!existingPassword) {
        content = setIniProperty(
          content,
          "ServerSettings",
          "ServerAdminPassword",
          generatePassword(20),
        );
        modified = true;
      }

      if (getIniProperty(content, "ServerSettings", "RCONEnabled") === null) {
        content = setIniProperty(
          content,
          "ServerSettings",
          "RCONEnabled",
          "True",
        );
        modified = true;
      }

      if (getIniProperty(content, "ServerSettings", "RCONPort") === null) {
        content = setIniProperty(
          content,
          "ServerSettings",
          "RCONPort",
          String(server.port + (getRconPortOffset(this.definition) || 19243)),
        );
        modified = true;
      }

      if (modified) {
        fs.writeFileSync(gusPath, content, "utf-8");
        logger.info(
          `[ARK] Repaired RCON config in GameUserSettings.ini for "${server.name}"`,
        );
      }
    } catch (err) {
      logger.error(
        `[ARK] Failed to ensure RCON config for "${server.name}":`,
        err,
      );
    }
  }

  // ── RCON ─────────────────────────────────────────────────────────

  readRconConfig(server: GameServer): RconConfig | null {
    // Primary: read RCON config from GameUserSettings.ini
    const gusPath = path.join(
      server.installPath,
      "ShooterGame",
      "Saved",
      "Config",
      "WindowsServer",
      "GameUserSettings.ini",
    );

    if (fs.existsSync(gusPath)) {
      try {
        const content = readGameFile(gusPath);
        const password = getIniProperty(
          content,
          "ServerSettings",
          "ServerAdminPassword",
        );
        const rconPort = getIniProperty(content, "ServerSettings", "RCONPort");

        if (password) {
          return {
            password,
            port: rconPort
              ? parseInt(rconPort, 10)
              : server.port + (getRconPortOffset(this.definition) || 0),
          };
        }
      } catch (error) {
        logger.debug(
          `[ARK] Could not read GameUserSettings.ini for RCON config: ${(error as Error).message}`,
        );
      }
    }

    // Fallback: derive RCON config from launch params (backward compat)
    const launchParams = server.launchParams || "";
    const portMatch = launchParams.match(/RCONPort=(\d+)/i);
    const passMatch = launchParams.match(/ServerAdminPassword=(\S+)/i);

    if (passMatch) {
      return {
        password: passMatch[1],
        port: portMatch
          ? parseInt(portMatch[1], 10)
          : server.port + (getRconPortOffset(this.definition) || 0),
      };
    }
    return null;
  }

  /**
   * Inject critical settings into launch params.
   * ARK overwrites GameUserSettings.ini on first start, so these values
   * must ALWAYS be passed as command-line args to ensure they take effect.
   *
   * Source priority:
   * 1. Existing launch params (user/initial-settings already set them)
   * 2. GameUserSettings.ini (if config has been generated)
   * 3. Defaults from server DB record (name, port)
   */
  getAdditionalLaunchParams(server: GameServer): string {
    const existingParams = server.launchParams || "";
    const configExists = this.isConfigGenerated(server);
    const params: string[] = [];

    // Helper: read from INI if it exists
    const readFromIni = (section: string, key: string): string | null => {
      if (!configExists) return null;
      const gusPath = path.join(
        server.installPath,
        "ShooterGame",
        "Saved",
        "Config",
        "WindowsServer",
        "GameUserSettings.ini",
      );
      try {
        const content = readGameFile(gusPath);
        return getIniProperty(content, section, key);
      } catch {
        return null;
      }
    };

    // Helper: get value with priority: existing launch params → INI → default
    const resolve = (
      key: string,
      iniSection: string,
      iniKey: string,
      defaultVal: string,
    ): string | null => {
      // If already in launch params, skip (no duplicate)
      if (new RegExp(`[?]${key}=`, "i").test(existingParams)) return null;
      // Try INI
      const iniVal = readFromIni(iniSection, iniKey);
      if (iniVal) return iniVal;
      // Use default
      return defaultVal;
    };

    const rconPort =
      server.port + (getRconPortOffset(this.definition) || 19243);
    const queryPort =
      server.queryPort ??
      server.port + (getQueryPortOffset(this.definition) || 19238);

    // ServerAdminPassword — critical for RCON
    const adminPass = resolve(
      "ServerAdminPassword",
      "ServerSettings",
      "ServerAdminPassword",
      "",
    );
    if (adminPass) {
      params.push(`?ServerAdminPassword=${adminPass}`);
    }

    // RCONPort
    const rconPortVal = resolve(
      "RCONPort",
      "ServerSettings",
      "RCONPort",
      String(rconPort),
    );
    if (rconPortVal) {
      params.push(`?RCONPort=${rconPortVal}`);
    }

    // RCONEnabled — always ensure it's on
    if (!/RCONEnabled=/i.test(existingParams)) {
      params.push("?RCONEnabled=True");
    }

    // QueryPort
    const queryPortVal = resolve(
      "QueryPort",
      "ServerSettings",
      "QueryPort",
      String(queryPort),
    );
    if (queryPortVal) {
      params.push(`?QueryPort=${queryPortVal}`);
    }

    return params.join("");
  }

  // ── Mods ─────────────────────────────────────────────────────────

  async copyModToServer(
    mod: ServerMod,
    serverInstallPath: string,
    workshopContentPath: string,
  ): Promise<ModCopyResult> {
    // ARK manages mods differently — Workshop content goes to ShooterGame/Content/Mods/
    // The engine handles loading from the mod directory structure
    const modsDir = path.join(
      serverInstallPath,
      "ShooterGame",
      "Content",
      "Mods",
    );
    if (!fs.existsSync(modsDir)) {
      fs.mkdirSync(modsDir, { recursive: true });
    }

    const targetPath = path.join(modsDir, mod.workshopId);

    try {
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
      copyFolderRecursive(workshopContentPath, targetPath);

      // Also copy to generic @ModName for server recognition
      const modName = mod.name;
      return { success: true, message: "Mod copied successfully", modName };
    } catch (error) {
      return {
        success: false,
        message: `Failed to copy mod: ${(error as Error).message}`,
      };
    }
  }

  generateModLaunchParams(mods: ServerMod[]): {
    modParam: string;
    serverModParam: string;
  } {
    const enabledMods = mods.filter(
      (m) => m.enabled && m.status === "installed",
    );

    if (enabledMods.length === 0) {
      return { modParam: "", serverModParam: "" };
    }

    // ARK uses -automanagedmods and ActiveMods=id1,id2,id3 in the map URL params
    const modIds = enabledMods
      .sort((a, b) => a.loadOrder - b.loadOrder)
      .map((m) => m.workshopId);

    return {
      modParam: `-automanagedmods -mods=${modIds.join(",")}`,
      serverModParam: "",
    };
  }

  /**
   * ARK mods live in ShooterGame/Content/Mods/{workshopId}
   */
  async uninstallMod(
    mod: ServerMod,
    serverInstallPath: string,
  ): Promise<ModCopyResult> {
    const modPath = path.join(
      serverInstallPath,
      "ShooterGame",
      "Content",
      "Mods",
      mod.workshopId,
    );
    try {
      if (fs.existsSync(modPath)) {
        fs.rmSync(modPath, { recursive: true, force: true });
      }
      return { success: true, message: "Mod uninstalled successfully" };
    } catch (error) {
      return {
        success: false,
        message: `Failed to uninstall mod: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Write ActiveMods list into GameUserSettings.ini for mod loading.
   * Called by modManager after mod install/enable/disable/reorder.
   */
  updateActiveModsInConfig(serverInstallPath: string, mods: ServerMod[]): void {
    const gusPath = path.join(
      serverInstallPath,
      "ShooterGame",
      "Saved",
      "Config",
      "WindowsServer",
      "GameUserSettings.ini",
    );

    if (!fs.existsSync(gusPath)) return;

    try {
      let content = readGameFile(gusPath);
      const enabledMods = mods
        .filter((m) => m.enabled && m.status === "installed")
        .sort((a, b) => a.loadOrder - b.loadOrder)
        .map((m) => m.workshopId);

      const activeModsValue =
        enabledMods.length > 0 ? enabledMods.join(",") : "";
      content = setIniProperty(
        content,
        "ServerSettings",
        "ActiveMods",
        activeModsValue,
      );

      fs.writeFileSync(gusPath, content, "utf-8");
      logger.info(
        `[ARK] Updated ActiveMods in GameUserSettings.ini: ${activeModsValue || "(none)"}`,
      );
    } catch (error) {
      logger.error(
        `[ARK] Failed to update ActiveMods in config: ${(error as Error).message}`,
      );
    }
  }

  // ── Player Management ────────────────────────────────────────────

  /**
   * Backfill player history from ShooterGame.log on server start.
   * ARK logs player joins/leaves with SteamID64 in parentheses.
   */
  parseServerLogs(serverId: number, installPath: string): void {
    const logsDir = path.join(installPath, "ShooterGame", "Saved", "Logs");
    if (!fs.existsSync(logsDir)) return;

    const logFile = this.findLatestLogFile(logsDir);
    if (!logFile) return;

    try {
      const content = readGameFile(logFile);
      const lines = content.split("\n").filter((l) => l.trim());

      logger.info(
        `[ARK] Backfilling from ${path.basename(logFile)} (${lines.length} lines)`,
      );

      let connectCount = 0;
      let disconnectCount = 0;

      for (const line of lines) {
        // Join pattern: "PlayerName joined this ARK!" or "PlayerName ist diesem ARK beigetreten!"
        // Followed by: "PlayerName joined this ARK! (SteamID) (TribeID: X)" or German equivalent
        // The SteamID line contains the 17-digit ID in parentheses
        const joinMatch = line.match(
          /\](.+?)\s+(?:joined this ARK!|ist diesem ARK beigetreten!)\s+\((\d{17})\)/,
        );
        if (joinMatch) {
          const playerName = joinMatch[1].replace(/[⎝⧹⧸⎠]/g, "").trim();
          const steamId = joinMatch[2];
          this.playerNameCache.set(steamId, playerName);
          recordPlayerConnect(serverId, steamId, playerName);
          connectCount++;
          continue;
        }

        // Leave pattern: "PlayerName left this ARK!" or "PlayerName hat diesen ARK verlassen!"
        const leaveMatch = line.match(
          /\](.+?)\s+(?:left this ARK!|hat diesen ARK verlassen!)\s+\((\d{17})\)/,
        );
        if (leaveMatch) {
          const steamId = leaveMatch[2];
          recordPlayerDisconnect(serverId, steamId);
          disconnectCount++;
        }
      }

      if (connectCount > 0 || disconnectCount > 0) {
        logger.info(
          `[ARK] Backfill complete: ${connectCount} connects, ${disconnectCount} disconnects`,
        );
      }
    } catch (error) {
      logger.debug(
        `[ARK] Could not read log for backfill: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Correct RCON-sourced player names using the ShooterGame.log.
   * ARK RCON replaces non-ASCII characters (emoji etc.) with '?',
   * but the log file preserves full Unicode names.
   */
  resolvePlayerNames(
    steamIdToName: Map<string, string>,
    installPath: string,
  ): void {
    this.refreshPlayerNameCache(installPath);

    for (const [steamId] of steamIdToName) {
      const correctName = this.playerNameCache.get(steamId);
      if (correctName) {
        steamIdToName.set(steamId, correctName);
      }
    }
  }

  /**
   * Refresh the SteamID → player name cache from ShooterGame.log.
   * Throttled to read the log at most once per minute.
   */
  private refreshPlayerNameCache(installPath: string): void {
    const now = Date.now();
    if (now - this.nameCacheLastRefresh < ArkAdapter.NAME_CACHE_TTL_MS) return;
    this.nameCacheLastRefresh = now;

    const logsDir = path.join(installPath, "ShooterGame", "Saved", "Logs");
    const logFile = this.findLatestLogFile(logsDir);
    if (!logFile) return;

    try {
      const content = readGameFile(logFile);
      const joinRegex =
        /\](.+?)\s+(?:joined this ARK!|ist diesem ARK beigetreten!)\s+\((\d{17})\)/g;
      let match;
      while ((match = joinRegex.exec(content)) !== null) {
        const name = match[1].replace(/[⎝⧹⧸⎠]/g, "").trim();
        const steamId = match[2];
        this.playerNameCache.set(steamId, name);
      }
    } catch {
      // Log file reading failed — keep existing cache
    }
  }

  /**
   * Find the latest ShooterGame.log in the logs directory.
   * Prefers ShooterGame.log over ServerGame.xxx.log for player data.
   */
  private findLatestLogFile(logsDir: string): string | null {
    try {
      const shooterGameLog = path.join(logsDir, "ShooterGame.log");
      if (fs.existsSync(shooterGameLog)) {
        const stats = fs.statSync(shooterGameLog);
        if (stats.size > 0) return shooterGameLog;
      }

      // Fallback: find the newest ServerGame.xxx.log
      const files = fs
        .readdirSync(logsDir)
        .filter((f) => f.startsWith("ServerGame") && f.endsWith(".log"));
      if (files.length === 0) return null;
      files.sort();
      return path.join(logsDir, files[files.length - 1]);
    } catch {
      return null;
    }
  }

  getWhitelistConfig(server: GameServer): PlayerFileConfig | null {
    return {
      filePath: path.join(
        server.installPath,
        "ShooterGame",
        "Saved",
        "PlayersJoinNoCheckList.txt",
      ),
      idType: "steam-id",
    };
  }

  getBanListConfig(server: GameServer): PlayerFileConfig | null {
    return {
      filePath: path.join(
        server.installPath,
        "ShooterGame",
        "Saved",
        "BannedPlayers.txt",
      ),
      idType: "steam-id",
    };
  }

  formatPlayerEntry(
    _type: "whitelist" | "ban",
    playerId: string,
    _playerName?: string,
  ): string {
    // ARK uses one SteamID64 per line, no comments
    return playerId;
  }

  parsePlayerEntry(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#"))
      return null;
    // ARK: entire line is a SteamID64
    if (/^\d{17}$/.test(trimmed)) return trimmed;
    return null;
  }

  // ── Logs ─────────────────────────────────────────────────────────

  getLogFileExtensions(): string[] {
    return [".log"];
  }

  getLogPaths(server: GameServer): LogPaths {
    return {
      directories: [
        path.join(server.installPath, "ShooterGame", "Saved", "Logs"),
        // ARK also writes logs next to the executable
        path.join(server.installPath, "ShooterGame", "Binaries", "Win64"),
      ],
      extensions: [".log"],
      archiveDir: path.join(
        server.installPath,
        "ShooterGame",
        "Saved",
        "Logs",
        "log_archive",
      ),
    };
  }

  getEditableFiles(server: GameServer): EditableFileConfig[] {
    return [
      {
        name: "whitelist.txt",
        path: path.join(
          server.installPath,
          "ShooterGame",
          "Saved",
          "PlayersJoinNoCheckList.txt",
        ),
      },
      {
        name: "ban.txt",
        path: path.join(
          server.installPath,
          "ShooterGame",
          "Saved",
          "BannedPlayers.txt",
        ),
      },
      {
        name: "GameUserSettings.ini",
        path: path.join(
          server.installPath,
          "ShooterGame",
          "Saved",
          "Config",
          "WindowsServer",
          "GameUserSettings.ini",
        ),
      },
      {
        name: "Game.ini",
        path: path.join(
          server.installPath,
          "ShooterGame",
          "Saved",
          "Config",
          "WindowsServer",
          "Game.ini",
        ),
      },
    ];
  }

  // ── Backup ──────────────────────────────────────────────────────

  getBackupPaths(_server: GameServer): BackupPathConfig {
    return {
      savePaths: ["ShooterGame/Saved/SavedArks"],
      configPaths: ["ShooterGame/Saved/Config"],
      excludePatterns: ["ShooterGame/Saved/Logs/**"],
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function copyFolderRecursive(source: string, target: string): void {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyFolderRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
