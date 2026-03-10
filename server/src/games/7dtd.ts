/**
 * 7 Days to Die Game Adapter
 *
 * Handles all 7DTD-specific server management logic:
 * - Telnet RCON config from serverconfig.xml
 * - XML-based server configuration
 * - No Workshop mod support (manual mod placement)
 * - Whitelist/ban via text files (SteamID64 format)
 */

import path from "path";
import fs from "fs";
import crypto from "crypto";
import { logger } from "../index.js";
import { BaseGameAdapter } from "./base.js";
import type {
  GameDefinition,
  RconConfig,
  PlayerFileConfig,
  EditableFileConfig,
} from "./types.js";
import type { GameServer } from "../types/index.js";

// ── Helpers ────────────────────────────────────────────────────────

function setXmlProperty(content: string, name: string, value: string): string {
  const regex = new RegExp(
    `(<property\\s+name\\s*=\\s*"${name}"\\s+value\\s*=\\s*")[^"]*"`,
    "i",
  );
  if (regex.test(content)) {
    return content.replace(regex, `$1${value}"`);
  }
  return content;
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

// ── 7DTD Adapter ───────────────────────────────────────────────────

export class SevenDaysAdapter extends BaseGameAdapter {
  readonly definition: GameDefinition = {
    id: "7dtd",
    name: "7 Days to Die",
    appId: 294420,
    executable: "7DaysToDieServer.exe",
    defaultPort: 26900,
    portCount: 4,
    queryPort: 26901,
    queryPortOffset: 1,
    requiresLogin: false,
    defaultLaunchParams:
      '-configfile=serverconfig.xml -logfile "output_log.txt" -quit -batchmode -nographics -dedicated',
    description:
      "Zombie survival with base building. Can be downloaded anonymously.",
    configFiles: ["serverconfig.xml"],
    firewallRules: [
      {
        portOffset: 0,
        portCount: 4,
        protocol: "TCP/UDP",
        description: "Game + Network",
      },
    ],
    capabilities: {
      rcon: "telnet",
      workshopMods: false,
      configEditor: true,
      playerTracking: true,
      scheduledMessages: true,
      whitelist: "file",
      banList: "file",
      playerIdentifier: "steam-id",
      logParsing: false,
    },
    broadcastCommand: 'say "{MESSAGE}"',
    playerListCommand: "listplayers",
    rconPortOffset: undefined,
  };

  // ── Lifecycle ────────────────────────────────────────────────────

  async postInstall(
    installPath: string,
    serverName: string,
    port: number,
  ): Promise<void> {
    logger.info(`[7DTD] Running post-install for ${serverName}...`);

    const dataPath = path.join(installPath, "Data");
    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true });
    }

    // Patch serverconfig.xml
    const configPath = path.join(installPath, "serverconfig.xml");
    if (fs.existsSync(configPath)) {
      try {
        let content = fs.readFileSync(configPath, "utf-8");
        content = setXmlProperty(content, "ServerName", serverName);
        content = setXmlProperty(
          content,
          "ServerDescription",
          `${serverName} - powered by Game Servum`,
        );
        content = setXmlProperty(content, "ServerPort", String(port));

        const telnetPassword = generatePassword(20);
        content = setXmlProperty(content, "TelnetPassword", telnetPassword);

        fs.writeFileSync(configPath, content, "utf-8");
        logger.info(
          `[7DTD] Updated serverconfig.xml: ServerName, ServerPort=${port}, TelnetPassword set`,
        );
      } catch (err) {
        logger.error(`[7DTD] Failed to patch serverconfig.xml:`, err);
      }
    } else {
      logger.warn(
        `[7DTD] serverconfig.xml not found at ${configPath}, skipping config patch`,
      );
    }

    logger.info(`[7DTD] Post-install complete for ${serverName}`);
  }

  validatePreStart(server: GameServer): string[] {
    const errors: string[] = [];

    const executablePath = path.join(server.installPath, server.executable);
    if (!fs.existsSync(executablePath)) {
      errors.push(`Server executable not found: ${server.executable}`);
    }

    const configPath = path.join(server.installPath, "serverconfig.xml");
    if (!fs.existsSync(configPath)) {
      errors.push(
        "serverconfig.xml not found. Server may need reinstallation.",
      );
    }

    return errors;
  }

  // ── RCON ─────────────────────────────────────────────────────────

  readRconConfig(server: GameServer): RconConfig | null {
    const configPath = path.join(
      server.installPath,
      this.definition.configFiles?.[0] || "serverconfig.xml",
    );

    try {
      if (!fs.existsSync(configPath)) return null;
      const content = fs.readFileSync(configPath, "utf-8");
      const portMatch = content.match(
        /<property\s+name="TelnetPort"\s+value="(\d+)"/i,
      );
      const passMatch = content.match(
        /<property\s+name="TelnetPassword"\s+value="([^"]*)"/i,
      );

      if (passMatch) {
        return {
          password: passMatch[1],
          port: portMatch ? parseInt(portMatch[1], 10) : 8081,
        };
      }
    } catch {
      // Config may not exist yet
    }

    return null;
  }

  // ── Mods (not supported via Workshop) ────────────────────────────

  // Uses BaseGameAdapter defaults: no-op copyModToServer, empty generateModLaunchParams

  // ── Player Management ────────────────────────────────────────────

  getWhitelistConfig(server: GameServer): PlayerFileConfig | null {
    return {
      filePath: path.join(server.installPath, "whitelist.txt"),
      idType: "steam-id",
    };
  }

  getBanListConfig(server: GameServer): PlayerFileConfig | null {
    return {
      filePath: path.join(server.installPath, "banned.txt"),
      idType: "steam-id",
    };
  }

  formatPlayerEntry(
    _type: "whitelist" | "ban",
    playerId: string,
    _playerName?: string,
  ): string {
    // 7DTD: one SteamID64 per line
    return playerId;
  }

  parsePlayerEntry(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#"))
      return null;
    if (/^\d{17}$/.test(trimmed)) return trimmed;
    return null;
  }

  // ── Logs ─────────────────────────────────────────────────────────

  getLogFileExtensions(): string[] {
    return [".log"];
  }

  getEditableFiles(server: GameServer): EditableFileConfig[] {
    return [
      {
        name: "whitelist.txt",
        path: path.join(server.installPath, "whitelist.txt"),
      },
      { name: "ban.txt", path: path.join(server.installPath, "banned.txt") },
      {
        name: "serverconfig.xml",
        path: path.join(server.installPath, "serverconfig.xml"),
      },
    ];
  }
}
