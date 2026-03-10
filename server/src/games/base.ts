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
