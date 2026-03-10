/**
 * Base Game Adapter
 *
 * Abstract base class providing sensible defaults for all GameAdapter methods.
 * Game-specific adapters extend this and override only what they need.
 */

import fs from "fs";
import path from "path";
import type { GameServer } from "../types/index.js";
import type { ServerMod } from "../types/index.js";
import type {
  GameAdapter,
  GameDefinition,
  RconConfig,
  PlayerFileConfig,
  PlayerListResult,
  EditableFileConfig,
  ModCopyResult,
  LogPaths,
} from "./types.js";

export abstract class BaseGameAdapter implements GameAdapter {
  abstract readonly definition: GameDefinition;

  // ── Lifecycle ────────────────────────────────────────────────────

  abstract postInstall(
    installPath: string,
    serverName: string,
    port: number,
  ): Promise<void>;

  /**
   * Default pre-start validation: check executable + config file exist.
   * Subclasses should call super.validatePreStart() and add game-specific checks.
   */
  validatePreStart(server: GameServer): string[] {
    const errors: string[] = [];

    const executablePath = path.join(server.installPath, server.executable);
    if (!fs.existsSync(executablePath)) {
      errors.push(`Server executable not found: ${server.executable}`);
    }

    const configFile = this.definition.configFiles?.[0];
    if (configFile) {
      const configPath = path.join(server.installPath, configFile);
      if (!fs.existsSync(configPath)) {
        errors.push(`Configuration file not found: ${configFile}`);
      }
    }

    return errors;
  }

  // ── RCON ─────────────────────────────────────────────────────────

  abstract readRconConfig(server: GameServer): RconConfig | null;

  // ── Mods ─────────────────────────────────────────────────────────

  /**
   * Default mod copy: copies workshop content to @ModName directory.
   * No bikey copying, no mod.cpp creation — games override if needed.
   */
  async copyModToServer(
    mod: ServerMod,
    serverInstallPath: string,
    workshopContentPath: string,
  ): Promise<ModCopyResult> {
    let modName = mod.name;
    const metaPath = path.join(workshopContentPath, "meta.cpp");
    if (fs.existsSync(metaPath)) {
      const metaContent = fs.readFileSync(metaPath, "utf-8");
      const nameMatch = metaContent.match(/name\s*=\s*"([^"]+)"/);
      if (nameMatch) {
        modName = nameMatch[1];
      }
    }

    const safeFolderName = modName
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .substring(0, 50);

    const targetPath = path.join(serverInstallPath, `@${safeFolderName}`);

    try {
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
      copyFolderRecursive(workshopContentPath, targetPath);
      return { success: true, message: "Mod copied successfully", modName };
    } catch (error) {
      return {
        success: false,
        message: `Failed to copy mod: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Default: no mod launch params (game doesn't use -mod= style params).
   */
  generateModLaunchParams(_mods: ServerMod[]): {
    modParam: string;
    serverModParam: string;
  } {
    return { modParam: "", serverModParam: "" };
  }

  // ── Player Management ────────────────────────────────────────────

  getWhitelistConfig(_server: GameServer): PlayerFileConfig | null {
    return null;
  }

  getBanListConfig(_server: GameServer): PlayerFileConfig | null {
    return null;
  }

  formatPlayerEntry(
    _type: "whitelist" | "ban",
    playerId: string,
    playerName?: string,
  ): string {
    return playerName ? `${playerId} // ${playerName}` : playerId;
  }

  parsePlayerEntry(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#"))
      return null;
    // Extract ID before any comment
    const id = trimmed.split(/\s+\/\/|\s+#/)[0].trim();
    return id || null;
  }

  /**
   * Default: append a text line to the whitelist/ban file.
   */
  addToPlayerList(
    server: GameServer,
    type: "whitelist" | "ban",
    playerId: string,
    playerName?: string,
  ): PlayerListResult {
    const config =
      type === "whitelist"
        ? this.getWhitelistConfig(server)
        : this.getBanListConfig(server);
    if (!config) {
      return { success: false, message: `This game does not support ${type}` };
    }

    let content = "";
    if (fs.existsSync(config.filePath)) {
      content = fs.readFileSync(config.filePath, "utf-8");
    }

    if (content.includes(playerId)) {
      return {
        success: false,
        message: `Player is already on the ${type === "ban" ? "ban list" : "whitelist"}`,
      };
    }

    const entry = this.formatPlayerEntry(type, playerId, playerName);
    const newContent =
      content.endsWith("\n") || content === ""
        ? `${content}${entry}\n`
        : `${content}\n${entry}\n`;

    fs.writeFileSync(config.filePath, newContent, "utf-8");
    return {
      success: true,
      message: `${playerName || "Player"} added to ${type === "ban" ? "ban list" : "whitelist"}`,
    };
  }

  /**
   * Default: remove matching lines from the whitelist/ban text file.
   */
  removeFromPlayerList(
    server: GameServer,
    type: "whitelist" | "ban",
    playerId: string,
  ): PlayerListResult {
    const config =
      type === "whitelist"
        ? this.getWhitelistConfig(server)
        : this.getBanListConfig(server);
    if (!config) {
      return { success: false, message: `This game does not support ${type}` };
    }

    if (!fs.existsSync(config.filePath)) {
      return {
        success: false,
        message: `${type === "ban" ? "Ban" : "Whitelist"} file not found`,
      };
    }

    const content = fs.readFileSync(config.filePath, "utf-8");
    const lines = content.split("\n");
    const filtered = lines.filter((line) => !line.trim().startsWith(playerId));

    if (lines.length === filtered.length) {
      return {
        success: false,
        message: `Player not found on the ${type === "ban" ? "ban list" : "whitelist"}`,
      };
    }

    fs.writeFileSync(config.filePath, filtered.join("\n"), "utf-8");
    return {
      success: true,
      message: `Player removed from ${type === "ban" ? "ban list" : "whitelist"}`,
    };
  }

  /**
   * Default: read the text file and return its content as-is.
   */
  getPlayerListContent(server: GameServer, type: "whitelist" | "ban"): string {
    const config =
      type === "whitelist"
        ? this.getWhitelistConfig(server)
        : this.getBanListConfig(server);
    if (!config) return "";
    if (!fs.existsSync(config.filePath)) return "";
    return fs.readFileSync(config.filePath, "utf-8");
  }

  // ── Logs ─────────────────────────────────────────────────────────

  getLogFileExtensions(): string[] {
    return [".log"];
  }

  /**
   * Default: scan resolved profilesPath for log files, archive into profilesPath/log_archive.
   */
  getLogPaths(server: GameServer): LogPaths {
    const profilesDir = server.profilesPath
      ? path.isAbsolute(server.profilesPath)
        ? server.profilesPath
        : path.join(server.installPath, server.profilesPath)
      : path.join(server.installPath, "profiles");
    return {
      directories: [profilesDir],
      extensions: this.getLogFileExtensions(),
      archiveDir: path.join(profilesDir, "log_archive"),
    };
  }

  getEditableFiles(_server: GameServer): EditableFileConfig[] {
    return [];
  }

  /**
   * Default: no extra environment variables needed.
   */
  getSpawnEnvironment(_server: GameServer): Record<string, string> {
    return {};
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
