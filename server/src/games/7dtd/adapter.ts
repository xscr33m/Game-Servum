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
import { logger } from "../../index.js";
import { BaseGameAdapter } from "../base.js";
import type {
  GameDefinition,
  RconConfig,
  PlayerFileConfig,
  PlayerListResult,
  EditableFileConfig,
  LogPaths,
  StartupDetector,
} from "../types.js";
import type { GameServer } from "../../types/index.js";

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
    logo: "7daystodie.png",
    appId: 294420,
    executable: "7DaysToDieServer.exe",
    defaultPort: 26900,
    portStride: 1000,
    requiresLogin: false,
    defaultLaunchParams:
      '-configfile=serverconfig.xml -logfile "output_log.txt" -quit -batchmode -nographics -dedicated',
    description:
      "Zombie survival with base building. Can be downloaded anonymously.",
    configFiles: ["serverconfig.xml"],
    firewallRules: [
      {
        portOffset: 0,
        portCount: 3,
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
      playerListEditable: false,
      profilesPath: false,
    },
    broadcastCommand: 'say "{MESSAGE}"',
    playerListCommand: "listplayers",
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
          `powered by Game-Servum`,
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

  // ── Player Management (serveradmin.xml) ──────────────────────────

  private getServerAdminPath(server: GameServer): string {
    return path.join(server.installPath, "serveradmin.xml");
  }

  getWhitelistConfig(server: GameServer): PlayerFileConfig | null {
    return {
      filePath: this.getServerAdminPath(server),
      idType: "steam-id",
    };
  }

  getBanListConfig(server: GameServer): PlayerFileConfig | null {
    return {
      filePath: this.getServerAdminPath(server),
      idType: "steam-id",
    };
  }

  formatPlayerEntry(
    _type: "whitelist" | "ban",
    playerId: string,
    _playerName?: string,
  ): string {
    return playerId;
  }

  parsePlayerEntry(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#"))
      return null;
    if (/^\d{17}$/.test(trimmed)) return trimmed;
    return null;
  }

  addToPlayerList(
    server: GameServer,
    type: "whitelist" | "ban",
    playerId: string,
    _playerName?: string,
  ): PlayerListResult {
    const adminPath = this.getServerAdminPath(server);
    const listLabel = type === "ban" ? "ban list" : "whitelist";

    try {
      let content = "";
      if (fs.existsSync(adminPath)) {
        content = fs.readFileSync(adminPath, "utf-8");
      } else {
        content = getServerAdminTemplate();
      }

      if (content.includes(`steamID="${playerId}"`)) {
        return {
          success: false,
          message: `Player is already on the ${listLabel}`,
        };
      }

      if (type === "whitelist") {
        const entry = `    <whitelisted steamID="${playerId}" />`;
        content = content.replace(/<\/whitelist>/i, `${entry}\n  </whitelist>`);
      } else {
        const entry = `    <blacklisted steamID="${playerId}" unbandate="" />`;
        content = content.replace(/<\/blacklist>/i, `${entry}\n  </blacklist>`);
      }

      fs.writeFileSync(adminPath, content, "utf-8");
      return { success: true, message: `Player added to ${listLabel}` };
    } catch (err) {
      return {
        success: false,
        message: `Failed to update ${listLabel}: ${(err as Error).message}`,
      };
    }
  }

  removeFromPlayerList(
    server: GameServer,
    type: "whitelist" | "ban",
    playerId: string,
  ): PlayerListResult {
    const adminPath = this.getServerAdminPath(server);
    const listLabel = type === "ban" ? "ban list" : "whitelist";

    try {
      if (!fs.existsSync(adminPath)) {
        return { success: false, message: `serveradmin.xml not found` };
      }

      const content = fs.readFileSync(adminPath, "utf-8");

      let pattern: RegExp;
      if (type === "whitelist") {
        pattern = new RegExp(
          `\\s*<whitelisted\\s+steamID="${playerId}"\\s*/>`,
          "i",
        );
      } else {
        pattern = new RegExp(
          `\\s*<blacklisted\\s+steamID="${playerId}"[^/]*/?>`,
          "i",
        );
      }

      if (!pattern.test(content)) {
        return {
          success: false,
          message: `Player not found on the ${listLabel}`,
        };
      }

      const updated = content.replace(pattern, "");
      fs.writeFileSync(adminPath, updated, "utf-8");
      return { success: true, message: `Player removed from ${listLabel}` };
    } catch (err) {
      return {
        success: false,
        message: `Failed to update ${listLabel}: ${(err as Error).message}`,
      };
    }
  }

  getPlayerListContent(server: GameServer, type: "whitelist" | "ban"): string {
    const adminPath = this.getServerAdminPath(server);
    if (!fs.existsSync(adminPath)) return "";

    try {
      const content = fs.readFileSync(adminPath, "utf-8");

      if (type === "whitelist") {
        const ids: string[] = [];
        const regex = /<whitelisted\s+steamID="(\d+)"\s*\/>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          ids.push(match[1]);
        }
        return ids.join("\n");
      } else {
        const ids: string[] = [];
        const regex = /<blacklisted\s+steamID="(\d+)"[^/]*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          ids.push(match[1]);
        }
        return ids.join("\n");
      }
    } catch {
      return "";
    }
  }

  // ── Logs ─────────────────────────────────────────────────────────

  getLogFileExtensions(): string[] {
    return [".txt"];
  }

  getLogPaths(server: GameServer): LogPaths {
    return {
      directories: [server.installPath],
      extensions: [".txt"],
      archiveDir: path.join(server.installPath, "log_archive"),
    };
  }

  getSpawnEnvironment(_server: GameServer): Record<string, string> {
    // 7DTD requires the CLIENT app ID set for Steam networking to work.
    // This matches the official startdedicated.bat: set SteamAppId=251570
    return { SteamAppId: "251570" };
  }

  getShutdownCommands(): {
    commands: string[];
    delayBetweenMs?: number;
  } | null {
    return { commands: ["saveworld", "shutdown"], delayBetweenMs: 3000 };
  }

  getStartupDetector(): StartupDetector | null {
    // 7DTD does not have a reliable startup pattern — uses fixed delay
    return null;
  }

  getEditableFiles(server: GameServer): EditableFileConfig[] {
    return [
      {
        name: "serveradmin.xml",
        path: path.join(server.installPath, "serveradmin.xml"),
      },
      {
        name: "serverconfig.xml",
        path: path.join(server.installPath, "serverconfig.xml"),
      },
    ];
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function getServerAdminTemplate(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<adminTools>
  <admins>
  </admins>
  <whitelist>
  </whitelist>
  <blacklist>
  </blacklist>
</adminTools>\n`;
}
