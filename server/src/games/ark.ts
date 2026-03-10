/**
 * ARK: Survival Evolved Game Adapter
 *
 * Handles all ARK-specific server management logic:
 * - Source RCON config from launch params (RCONPort, ServerAdminPassword)
 * - GameUserSettings.ini config editor
 * - Workshop mods via -automanagedmods + ActiveMods in GameUserSettings.ini
 * - Whitelist via PlayersJoinNoCheckList.txt / Ban via BannedPlayers.txt
 */

import path from "path";
import fs from "fs";
import { logger } from "../index.js";
import { BaseGameAdapter } from "./base.js";
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

// ── ARK Adapter ────────────────────────────────────────────────────

export class ArkAdapter extends BaseGameAdapter {
  readonly definition: GameDefinition = {
    id: "ark",
    name: "ARK: Survival Evolved",
    appId: 376030,
    workshopAppId: 346110, // ARK Workshop mods are under the game AppID (346110), not the server (376030)
    executable: "ShooterGameServer.exe",
    defaultPort: 7777,
    portCount: 2,
    queryPort: 27015,
    queryPortOffset: 19238,
    requiresLogin: false,
    defaultLaunchParams:
      "TheIsland?listen?SessionName=MyARKServer -server -log",
    description: "Dinosaur survival game. Can be downloaded anonymously.",
    configFiles: [
      "ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini",
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
      logParsing: false,
      playerListEditable: true,
    },
    broadcastCommand: "ServerChat {MESSAGE}",
    playerListCommand: "ListPlayers",
    rconPortOffset: 19243,
  };

  // ── Lifecycle ────────────────────────────────────────────────────

  async postInstall(
    installPath: string,
    serverName: string,
    _port: number,
  ): Promise<void> {
    logger.info(`[ARK] Running post-install for ${serverName}...`);

    // ARK needs ShooterGame/Saved directory structure
    const savedPath = path.join(
      installPath,
      "ShooterGame",
      "Saved",
      "Config",
      "WindowsServer",
    );
    if (!fs.existsSync(savedPath)) {
      fs.mkdirSync(savedPath, { recursive: true });
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

    // ARK config is optional (generated on first launch) — just warn if missing
    // No hard error for missing config

    return errors;
  }

  // ── RCON ─────────────────────────────────────────────────────────

  readRconConfig(server: GameServer): RconConfig | null {
    // ARK: derive RCON port and password from launch params
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

  // ── Player Management ────────────────────────────────────────────

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
