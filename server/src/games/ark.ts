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
import { logger } from "../index.js";
import { recordPlayerConnect, recordPlayerDisconnect } from "../db/index.js";
import { BaseGameAdapter } from "./base.js";
import { readGameFile } from "./encoding.js";
import type {
  GameDefinition,
  RconConfig,
  PlayerFileConfig,
  EditableFileConfig,
  ModCopyResult,
  LogPaths,
} from "./types.js";
import type { GameServer } from "../types/index.js";
import type { ServerMod } from "../types/index.js";

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
    appId: 376030,
    workshopAppId: 346110, // ARK Workshop mods are under the game AppID (346110), not the server (376030)
    executable: "ShooterGame/Binaries/Win64/ShooterGameServer.exe",
    defaultPort: 7777,
    portCount: 2,
    queryPort: 27015,
    queryPortOffset: 19238,
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
    },
    broadcastCommand: "ServerChat {MESSAGE}",
    playerListCommand: "ListPlayers",
    rconPortOffset: 19243,
    startupCompletePattern: "Full Startup: .+ seconds",
  };

  // ── Lifecycle ────────────────────────────────────────────────────

  async postInstall(
    installPath: string,
    serverName: string,
    port: number,
  ): Promise<void> {
    logger.info(`[ARK] Running post-install for ${serverName}...`);

    // ARK needs ShooterGame/Saved directory structure
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

    // Create minimal INI files from scratch.
    // ARK overwrites configs copied from DefaultGameUserSettings.ini on first start,
    // but respects pre-existing minimal files and merges its own defaults on top.
    const gusTarget = path.join(savedConfigPath, "GameUserSettings.ini");
    if (!fs.existsSync(gusTarget)) {
      fs.writeFileSync(gusTarget, "", "utf-8");
    }
    const gameTarget = path.join(savedConfigPath, "Game.ini");
    if (!fs.existsSync(gameTarget)) {
      fs.writeFileSync(gameTarget, "", "utf-8");
    }

    // Ensure Logs directory exists (ARK writes to ShooterGame/Saved/Logs/)
    const logsPath = path.join(installPath, "ShooterGame", "Saved", "Logs");
    if (!fs.existsSync(logsPath)) {
      fs.mkdirSync(logsPath, { recursive: true });
    }

    // Configure GameUserSettings.ini with server-specific settings + all form editor defaults
    const gusPath = path.join(savedConfigPath, "GameUserSettings.ini");
    try {
      let gusContent = readGameFile(gusPath);
      const adminPassword = generatePassword(20);
      const rconPort = port + (this.definition.rconPortOffset || 19243);
      const queryPort = port + (this.definition.queryPortOffset || 19238);

      // All [ServerSettings] keys the form editor expects
      const serverSettings: Record<string, string> = {
        SessionName: serverName,
        ServerPassword: "",
        ServerAdminPassword: adminPassword,
        RCONEnabled: "True",
        RCONPort: String(rconPort),
        Port: String(port),
        QueryPort: String(queryPort),
        AllowThirdPersonPlayer: "True",
        ShowMapPlayerLocation: "True",
        ServerCrosshair: "True",
        AllowHitMarkers: "True",
        EnablePvPGamma: "True",
        AllowFlyerCarryPvE: "False",
        DifficultyOffset: "1.000000",
        OverrideOfficialDifficulty: "5.000000",
        MaxTamedDinos: "5000.000000",
        ItemStackSizeMultiplier: "1.000000",
        TheMaxStructuresInRange: "10500.000000",
        PerPlatformMaxStructuresMultiplier: "1.000000",
        PlatformSaddleBuildAreaBoundsMultiplier: "1.000000",
        StructurePickupTimeAfterPlacement: "30.000000",
        StructurePickupHoldDuration: "0.500000",
        StructurePreventResourceRadiusMultiplier: "1.000000",
        AllowIntegratedSPlusStructures: "True",
        DisableStructureDecayPvE: "False",
        PvEDinoDecayPeriodMultiplier: "1.000000",
        AutoSavePeriodMinutes: "15.000000",
        KickIdlePlayersPeriod: "3600.000000",
        TribeNameChangeCooldown: "15.000000",
        AllowHideDamageSourceFromLogs: "True",
        RCONServerGameLogBuffer: "600.000000",
        RaidDinoCharacterFoodDrainMultiplier: "1.000000",
        OxygenSwimSpeedStatMultiplier: "1.000000",
        ListenServerTetherDistanceMultiplier: "1.000000",
      };

      for (const [key, value] of Object.entries(serverSettings)) {
        gusContent = setIniProperty(gusContent, "ServerSettings", key, value);
      }

      // [SessionSettings] SessionName
      gusContent = setIniProperty(
        gusContent,
        "SessionSettings",
        "SessionName",
        serverName,
      );

      // [/Script/Engine.GameSession] MaxPlayers
      gusContent = setIniProperty(
        gusContent,
        "/Script/Engine.GameSession",
        "MaxPlayers",
        "70",
      );

      fs.writeFileSync(gusPath, gusContent, "utf-8");
      logger.info(
        `[ARK] Configured GameUserSettings.ini: SessionName=${serverName}, Port=${port}, QueryPort=${queryPort}, RCONPort=${rconPort}, RCONEnabled=True`,
      );
    } catch (err) {
      logger.error(`[ARK] Failed to configure GameUserSettings.ini:`, err);
    }

    // Configure Game.ini with default multiplier values
    const gamePath = path.join(savedConfigPath, "Game.ini");
    try {
      let gameContent = readGameFile(gamePath);

      const modeSettings: Record<string, string> = {
        XPMultiplier: "1.000000",
        TamingSpeedMultiplier: "1.000000",
        HarvestAmountMultiplier: "1.000000",
        DayCycleSpeedScale: "1.000000",
        NightTimeSpeedScale: "1.000000",
        DinoDamageMultiplier: "1.000000",
        PlayerDamageMultiplier: "1.000000",
        StructureDamageMultiplier: "1.000000",
        PlayerResistanceMultiplier: "1.000000",
        DinoResistanceMultiplier: "1.000000",
        StructureResistanceMultiplier: "1.000000",
        DinoCountMultiplier: "1.000000",
        ResourcesRespawnPeriodMultiplier: "1.000000",
        EggHatchSpeedMultiplier: "1.000000",
        BabyMatureSpeedMultiplier: "1.000000",
        MatingIntervalMultiplier: "1.000000",
        BabyFoodConsumptionSpeedMultiplier: "1.000000",
        CropGrowthSpeedMultiplier: "1.000000",
        FuelConsumptionIntervalMultiplier: "1.000000",
        KillXPMultiplier: "1.000000",
        HarvestXPMultiplier: "1.000000",
        CraftXPMultiplier: "1.000000",
        GenericXPMultiplier: "1.000000",
        SpecialXPMultiplier: "1.000000",
      };

      for (const [key, value] of Object.entries(modeSettings)) {
        gameContent = setIniProperty(
          gameContent,
          "/Script/ShooterGame.ShooterGameMode",
          key,
          value,
        );
      }

      fs.writeFileSync(gamePath, gameContent, "utf-8");
      logger.info(`[ARK] Configured Game.ini with default multiplier values`);
    } catch (err) {
      logger.error(`[ARK] Failed to configure Game.ini:`, err);
    }

    logger.info(`[ARK] Post-install complete for ${serverName}`);
  }

  validatePreStart(server: GameServer): string[] {
    const errors: string[] = [];

    // Check executable
    const executablePath = path.join(server.installPath, server.executable);
    if (!fs.existsSync(executablePath)) {
      errors.push(`Server executable not found: ${server.executable}`);
    }

    // Ensure RCON config exists before every start.
    // ARK may overwrite the INI on first launch, losing the RCON settings
    // written by postInstall. This re-applies them if missing.
    this.ensureRconConfig(server);

    return errors;
  }

  /**
   * Ensure RCON-critical keys exist in GameUserSettings.ini.
   * Called before every server start and on agent startup (via ensureConfigSections).
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
          String(server.port + (this.definition.rconPortOffset || 19243)),
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

  /**
   * Ensure all required INI sections/keys exist in config files.
   * Called at startup for existing ARK servers that were installed before
   * the enhanced postInstall — adds missing sections/keys with defaults.
   */
  ensureConfigSections(server: GameServer): void {
    const savedConfigPath = path.join(
      server.installPath,
      "ShooterGame",
      "Saved",
      "Config",
      "WindowsServer",
    );

    // ── GameUserSettings.ini ──
    const gusPath = path.join(savedConfigPath, "GameUserSettings.ini");
    if (fs.existsSync(gusPath)) {
      try {
        let gusContent = readGameFile(gusPath);
        let modified = false;

        // [ServerSettings] defaults — only add keys that are missing
        const serverDefaults: Record<string, string> = {
          ServerPassword: "",
          RCONEnabled: "True",
          AllowThirdPersonPlayer: "True",
          ShowMapPlayerLocation: "True",
          ServerCrosshair: "True",
          AllowHitMarkers: "True",
          EnablePvPGamma: "True",
          AllowFlyerCarryPvE: "False",
          DifficultyOffset: "1.000000",
          OverrideOfficialDifficulty: "5.000000",
          MaxTamedDinos: "5000.000000",
          ItemStackSizeMultiplier: "1.000000",
          TheMaxStructuresInRange: "10500.000000",
          PerPlatformMaxStructuresMultiplier: "1.000000",
          PlatformSaddleBuildAreaBoundsMultiplier: "1.000000",
          StructurePickupTimeAfterPlacement: "30.000000",
          StructurePickupHoldDuration: "0.500000",
          StructurePreventResourceRadiusMultiplier: "1.000000",
          AllowIntegratedSPlusStructures: "True",
          DisableStructureDecayPvE: "False",
          PvEDinoDecayPeriodMultiplier: "1.000000",
          AutoSavePeriodMinutes: "15.000000",
          KickIdlePlayersPeriod: "3600.000000",
          TribeNameChangeCooldown: "15.000000",
          AllowHideDamageSourceFromLogs: "True",
          RCONServerGameLogBuffer: "600.000000",
          RaidDinoCharacterFoodDrainMultiplier: "1.000000",
          OxygenSwimSpeedStatMultiplier: "1.000000",
          ListenServerTetherDistanceMultiplier: "1.000000",
        };

        for (const [key, value] of Object.entries(serverDefaults)) {
          if (getIniProperty(gusContent, "ServerSettings", key) === null) {
            gusContent = setIniProperty(
              gusContent,
              "ServerSettings",
              key,
              value,
            );
            modified = true;
          }
        }

        // Ensure RCON config exists (delegates to shared helper)
        this.ensureRconConfig(server);

        // [SessionSettings] SessionName
        if (
          getIniProperty(gusContent, "SessionSettings", "SessionName") === null
        ) {
          gusContent = setIniProperty(
            gusContent,
            "SessionSettings",
            "SessionName",
            server.name,
          );
          modified = true;
        }

        // [/Script/Engine.GameSession] MaxPlayers
        if (
          getIniProperty(
            gusContent,
            "/Script/Engine.GameSession",
            "MaxPlayers",
          ) === null
        ) {
          gusContent = setIniProperty(
            gusContent,
            "/Script/Engine.GameSession",
            "MaxPlayers",
            "70",
          );
          modified = true;
        }

        if (modified) {
          fs.writeFileSync(gusPath, gusContent, "utf-8");
          logger.info(
            `[ARK] Repaired missing sections/keys in GameUserSettings.ini for "${server.name}"`,
          );
        }
      } catch (err) {
        logger.error(
          `[ARK] Failed to repair GameUserSettings.ini for "${server.name}":`,
          err,
        );
      }
    }

    // ── Game.ini ──
    const gamePath = path.join(savedConfigPath, "Game.ini");
    if (fs.existsSync(gamePath)) {
      try {
        let gameContent = readGameFile(gamePath);
        let modified = false;

        const modeDefaults: Record<string, string> = {
          XPMultiplier: "1.000000",
          TamingSpeedMultiplier: "1.000000",
          HarvestAmountMultiplier: "1.000000",
          DayCycleSpeedScale: "1.000000",
          NightTimeSpeedScale: "1.000000",
          DinoDamageMultiplier: "1.000000",
          PlayerDamageMultiplier: "1.000000",
          StructureDamageMultiplier: "1.000000",
          PlayerResistanceMultiplier: "1.000000",
          DinoResistanceMultiplier: "1.000000",
          StructureResistanceMultiplier: "1.000000",
          DinoCountMultiplier: "1.000000",
          ResourcesRespawnPeriodMultiplier: "1.000000",
          EggHatchSpeedMultiplier: "1.000000",
          BabyMatureSpeedMultiplier: "1.000000",
          MatingIntervalMultiplier: "1.000000",
          BabyFoodConsumptionSpeedMultiplier: "1.000000",
          CropGrowthSpeedMultiplier: "1.000000",
          FuelConsumptionIntervalMultiplier: "1.000000",
          KillXPMultiplier: "1.000000",
          HarvestXPMultiplier: "1.000000",
          CraftXPMultiplier: "1.000000",
          GenericXPMultiplier: "1.000000",
          SpecialXPMultiplier: "1.000000",
        };

        for (const [key, value] of Object.entries(modeDefaults)) {
          if (
            getIniProperty(
              gameContent,
              "/Script/ShooterGame.ShooterGameMode",
              key,
            ) === null
          ) {
            gameContent = setIniProperty(
              gameContent,
              "/Script/ShooterGame.ShooterGameMode",
              key,
              value,
            );
            modified = true;
          }
        }

        if (modified) {
          fs.writeFileSync(gamePath, gameContent, "utf-8");
          logger.info(
            `[ARK] Repaired missing sections/keys in Game.ini for "${server.name}"`,
          );
        }
      } catch (err) {
        logger.error(
          `[ARK] Failed to repair Game.ini for "${server.name}":`,
          err,
        );
      }
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
              : server.port + (this.definition.rconPortOffset || 0),
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
          : server.port + (this.definition.rconPortOffset || 0),
      };
    }
    return null;
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
