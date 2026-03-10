import path from "path";
import fs from "fs";
import { spawn, type ChildProcess } from "child_process";
import { getConfig, getSteamCMDExecutable } from "./config.js";
import { getGameAdapter, getGameDefinition } from "../games/index.js";
import { broadcast, logger } from "../index.js";
import {
  getModById,
  getModsByServerId,
  updateModStatus,
  updateModWorkshopTimestamp,
  deleteMod,
  getServerById,
} from "../db/index.js";
import { getSteamConfig } from "../db/index.js";
import type { ServerMod } from "../types/index.js";

/**
 * Get the correct Workshop App ID for downloads.
 * Some games have a different AppID for Workshop mods vs the dedicated server.
 * E.g. DayZ: game=221100, server=223350 — mods are under 221100.
 */
function getWorkshopAppId(gameId: string, serverAppId: number): number {
  const gameDef = getGameDefinition(gameId);
  return gameDef?.workshopAppId ?? serverAppId;
}

// Track active mod installations
const activeInstallations = new Map<number, ChildProcess>();

/**
 * Extract Workshop ID from Steam URL or direct ID
 */
export function parseWorkshopId(input: string): string | null {
  // If it's already a number, return it
  if (/^\d+$/.test(input.trim())) {
    return input.trim();
  }

  // Try to extract from Steam Workshop URL
  // Formats:
  // https://steamcommunity.com/sharedfiles/filedetails/?id=2116157322
  // https://steamcommunity.com/workshop/filedetails/?id=2116157322
  const match = input.match(/[?&]id=(\d+)/);
  if (match) {
    return match[1];
  }

  return null;
}

/**
 * Get mod info from Steam Workshop API
 */
export async function getWorkshopModInfo(workshopId: string): Promise<{
  name: string;
  description?: string;
  timeUpdated?: number;
} | null> {
  try {
    // Steam Workshop API endpoint
    const response = await fetch(
      "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `itemcount=1&publishedfileids[0]=${workshopId}`,
      },
    );

    const data = (await response.json()) as {
      response?: {
        publishedfiledetails?: Array<{
          result: number;
          title?: string;
          description?: string;
          time_updated?: number;
        }>;
      };
    };
    const fileDetails = data?.response?.publishedfiledetails?.[0];

    if (fileDetails && fileDetails.result === 1) {
      return {
        name: fileDetails.title || `Mod ${workshopId}`,
        description: fileDetails.description,
        timeUpdated: fileDetails.time_updated,
      };
    }

    return null;
  } catch (error) {
    logger.error(
      `[ModManager] Failed to fetch mod info for ${workshopId}:`,
      error,
    );
    return null;
  }
}

/**
 * Install a mod from Steam Workshop
 * Requires a logged-in Steam account for DayZ mods
 */
export async function installMod(
  modId: number,
): Promise<{ success: boolean; message: string }> {
  const mod = getModById(modId);
  if (!mod) {
    return { success: false, message: "Mod not found" };
  }

  const server = getServerById(mod.serverId);
  if (!server) {
    return { success: false, message: "Server not found" };
  }

  // Check if already installing
  if (activeInstallations.has(modId)) {
    return { success: false, message: "Mod is already being installed" };
  }

  const config = getConfig();
  const steamcmdPath = getSteamCMDExecutable();

  // Check SteamCMD exists
  if (!fs.existsSync(steamcmdPath)) {
    updateModStatus(modId, "error");
    broadcast("mod:error", {
      modId,
      serverId: server.id,
      error: "SteamCMD not installed",
    });
    return { success: false, message: "SteamCMD not installed" };
  }

  // Get Steam login info - Workshop download requires logged-in user for DayZ
  const steamConfig = getSteamConfig();

  if (!steamConfig?.isLoggedIn || !steamConfig.username) {
    updateModStatus(modId, "error");
    const errorMsg =
      "Steam login required to download Workshop mods. Please login via the Setup page.";
    broadcast("mod:error", {
      modId,
      serverId: server.id,
      error: errorMsg,
    });
    return { success: false, message: errorMsg };
  }

  // Update status to downloading
  updateModStatus(modId, "downloading");
  broadcast("mod:progress", {
    modId,
    serverId: server.id,
    status: "downloading",
    message: `Starting download of ${mod.name}...`,
  });

  // Build SteamCMD arguments for workshop download
  // Workshop downloads require:
  // 1. +force_install_dir pointing to the server/game installation
  // 2. +login with valid Steam account
  // 3. +workshop_download_item <appId> <workshopId> validate
  const args: string[] = [];

  // Set install directory to server path (required for workshop downloads)
  args.push("+force_install_dir", server.installPath);

  // Login with saved credentials (SteamCMD caches session)
  args.push("+login", steamConfig.username);

  // Use the correct Workshop App ID (e.g. DayZ game=221100, not server=223350)
  const workshopAppId = getWorkshopAppId(server.gameId, server.appId);

  // Download workshop item with validation: +workshop_download_item <appId> <workshopId> validate
  args.push(
    "+workshop_download_item",
    String(workshopAppId),
    mod.workshopId,
    "validate",
  );
  args.push("+quit");

  logger.info(
    `[Mod Install] Starting download for mod ${mod.workshopId} (${mod.name})`,
  );
  logger.info(`[Mod Install] SteamCMD args: ${args.join(" ")}`);

  return new Promise((resolve) => {
    const steamcmd = spawn(steamcmdPath, args, {
      cwd: config.steamcmdPath,
    });

    activeInstallations.set(modId, steamcmd);
    let output = "";
    let errorOutput = "";

    steamcmd.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      output += text;
      logger.debug("[SteamCMD Mod] stdout:", text.trim());

      // Broadcast output to UI for debugging
      broadcast("steamcmd:output", {
        message: text,
        context: "mod",
        modId,
      });

      // Parse progress if possible
      if (text.includes("Downloading item")) {
        broadcast("mod:progress", {
          modId,
          serverId: server.id,
          status: "downloading",
          message: "Downloading from Workshop...",
        });
      }

      // Check for success
      if (text.includes("Success. Downloaded item")) {
        broadcast("mod:progress", {
          modId,
          serverId: server.id,
          status: "downloading",
          message: "Download complete, copying to server...",
        });
      }

      // Check for common errors
      if (text.includes("ERROR!") || text.includes("FAILED")) {
        errorOutput += text;
      }
    });

    steamcmd.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      errorOutput += text;
      logger.error("[SteamCMD Mod] stderr:", text);

      broadcast("steamcmd:output", {
        message: text,
        context: "mod",
        modId,
        isError: true,
      });
    });

    steamcmd.on("close", async (code) => {
      activeInstallations.delete(modId);
      logger.info(`[Mod Install] SteamCMD exited with code ${code}`);

      // Check for success indicators
      const downloadSuccess =
        output.includes("Success. Downloaded item") ||
        (output.includes("Workshop content will be downloaded") && code === 0);

      if (downloadSuccess) {
        logger.info(`[Mod Install] Download successful, copying to server...`);

        // Copy mod to server directory
        const copyResult = await copyModToServer(
          mod,
          server.installPath,
          server.gameId,
          workshopAppId,
        );

        if (copyResult.success) {
          logger.info(
            `[Mod Install] Mod ${mod.workshopId} installed successfully as ${copyResult.modName}`,
          );
          updateModStatus(modId, "installed", copyResult.modName || mod.name);

          // Fetch and store the workshop time_updated for future update checks
          try {
            const modInfo = await getWorkshopModInfo(mod.workshopId);
            if (modInfo?.timeUpdated) {
              updateModWorkshopTimestamp(
                modId,
                new Date(modInfo.timeUpdated * 1000).toISOString(),
              );
            }
          } catch {
            // Non-critical: update check will still work via installed_at fallback
          }

          broadcast("mod:installed", {
            modId,
            serverId: server.id,
            name: copyResult.modName || mod.name,
          });
          resolve({ success: true, message: "Mod installed successfully" });
        } else {
          logger.error(
            `[Mod Install] Failed to copy mod: ${copyResult.message}`,
          );
          updateModStatus(modId, "error");
          broadcast("mod:error", {
            modId,
            serverId: server.id,
            error: copyResult.message,
          });
          resolve({ success: false, message: copyResult.message });
        }
      } else {
        // Extract meaningful error message from output
        let errorMsg = "Failed to download mod from Workshop";

        // Check for common Steam/SteamCMD errors
        if (
          output.includes("Login Failure") ||
          output.includes("Invalid Password")
        ) {
          errorMsg = "Steam login failed. Please re-login via Setup page.";
        } else if (output.includes("No subscription")) {
          errorMsg =
            "No subscription to this Workshop item. The mod may require purchase or may no longer exist.";
        } else if (output.includes("Rate Limit Exceeded")) {
          errorMsg =
            "Steam rate limit exceeded. Please wait a few minutes and try again.";
        } else if (output.includes("Timeout")) {
          errorMsg = "Download timed out. Please try again.";
        } else if (
          output.includes("Two-factor") ||
          output.includes("Steam Guard")
        ) {
          errorMsg =
            "Steam Guard authentication required. Please re-login via Setup page.";
        } else if (output.includes("failed (Failure)")) {
          errorMsg =
            "Workshop download failed. This can happen if the item doesn't exist, your Steam account doesn't own the game, or SteamCMD needs to update. Try again.";
        } else if (errorOutput) {
          // Include some error output for debugging
          errorMsg = `Download failed: ${errorOutput.substring(0, 200)}`;
        }

        logger.error(
          `[Mod Install] Download failed for ${mod.workshopId}: ${errorMsg}`,
        );
        logger.error(`[Mod Install] Full output: ${output}`);

        updateModStatus(modId, "error");
        broadcast("mod:error", {
          modId,
          serverId: server.id,
          error: errorMsg,
          details: output.substring(0, 500), // Send some output for debugging
        });
        resolve({ success: false, message: errorMsg });
      }
    });

    steamcmd.on("error", (error) => {
      activeInstallations.delete(modId);
      updateModStatus(modId, "error");
      broadcast("mod:error", {
        modId,
        serverId: server.id,
        error: error.message,
      });
      resolve({ success: false, message: error.message });
    });
  });
}

/**
 * Resolve workshop download path and delegate copy to game adapter.
 */
async function copyModToServer(
  mod: ServerMod,
  serverPath: string,
  gameId: string,
  appId: number,
): Promise<{ success: boolean; message: string; modName?: string }> {
  const config = getConfig();

  // With +force_install_dir <serverPath>, workshop downloads go to:
  // <serverPath>/steamapps/workshop/content/<appId>/<workshopId>
  // Also check the legacy steamcmd path as fallback
  const workshopPathInServer = path.join(
    serverPath,
    "steamapps",
    "workshop",
    "content",
    String(appId),
    mod.workshopId,
  );

  const workshopPathInSteamcmd = path.join(
    config.steamcmdPath,
    "steamapps",
    "workshop",
    "content",
    String(appId),
    mod.workshopId,
  );

  // Try server path first (when +force_install_dir is used), then steamcmd path
  let workshopPath: string;
  if (fs.existsSync(workshopPathInServer)) {
    workshopPath = workshopPathInServer;
    logger.info(
      `[Mod Copy] Found workshop content at server path: ${workshopPath}`,
    );
  } else if (fs.existsSync(workshopPathInSteamcmd)) {
    workshopPath = workshopPathInSteamcmd;
    logger.info(
      `[Mod Copy] Found workshop content at steamcmd path: ${workshopPath}`,
    );
  } else {
    return {
      success: false,
      message: `Workshop content not found. Checked:\n- ${workshopPathInServer}\n- ${workshopPathInSteamcmd}`,
    };
  }

  // Delegate to game adapter for game-specific copy logic
  const adapter = getGameAdapter(gameId);
  if (!adapter) {
    return { success: false, message: `No game adapter found for ${gameId}` };
  }

  return adapter.copyModToServer(mod, serverPath, workshopPath);
}

/**
 * Uninstall a mod (remove from server directory)
 */
export async function uninstallMod(
  modId: number,
): Promise<{ success: boolean; message: string }> {
  const mod = getModById(modId);
  if (!mod) {
    return { success: false, message: "Mod not found" };
  }

  const server = getServerById(mod.serverId);
  if (!server) {
    return { success: false, message: "Server not found" };
  }

  // Find and remove mod folder
  try {
    const serverPath = server.installPath;
    const entries = fs.readdirSync(serverPath);

    // Look for mod folders starting with @
    for (const entry of entries) {
      if (entry.startsWith("@")) {
        const modFolder = path.join(serverPath, entry);
        const metaPath = path.join(modFolder, "meta.cpp");

        // Check if this is our mod by looking at meta.cpp or mod folder name
        if (fs.existsSync(metaPath)) {
          const metaContent = fs.readFileSync(metaPath, "utf-8");
          // Check for workshop ID in meta
          if (metaContent.includes(mod.workshopId)) {
            fs.rmSync(modFolder, { recursive: true, force: true });
            deleteMod(modId);
            return { success: true, message: "Mod uninstalled successfully" };
          }
        }
      }
    }

    // If we couldn't find the specific mod folder, just delete from DB
    deleteMod(modId);
    return { success: true, message: "Mod removed from database" };
  } catch (error) {
    return {
      success: false,
      message: `Failed to uninstall mod: ${(error as Error).message}`,
    };
  }
}

/**
 * Generate mod launch parameters for the server's game type.
 * Delegates to the game adapter for game-specific param format.
 */
export function generateModParams(serverId: number): {
  modParam: string;
  serverModParam: string;
} {
  const server = getServerById(serverId);
  if (!server) {
    return { modParam: "", serverModParam: "" };
  }

  const adapter = getGameAdapter(server.gameId);
  if (!adapter) {
    return { modParam: "", serverModParam: "" };
  }

  const mods = getModsByServerId(serverId);
  const enabledMods = mods.filter((m) => m.enabled && m.status === "installed");

  return adapter.generateModLaunchParams(enabledMods);
}

/**
 * Cancel an ongoing mod installation
 */
export function cancelModInstallation(modId: number): {
  success: boolean;
  message: string;
} {
  const process = activeInstallations.get(modId);
  if (process) {
    process.kill();
    activeInstallations.delete(modId);
    updateModStatus(modId, "error");
    return { success: true, message: "Installation cancelled" };
  }
  return { success: false, message: "No active installation found" };
}

/**
 * Check if a mod is currently being installed
 */
export function isModInstalling(modId: number): boolean {
  return activeInstallations.has(modId);
}

/**
 * Check multiple mods for updates via Steam Workshop API (batch request)
 * Returns list of mods that have updates available
 */
export async function checkModsForUpdates(
  serverId: number,
): Promise<{ modId: number; workshopId: string; name: string }[]> {
  const mods = getModsByServerId(serverId);
  const installedMods = mods.filter(
    (m) => m.status === "installed" || m.status === "update_available",
  );

  if (installedMods.length === 0) return [];

  try {
    // Build batch request body for all mods
    const bodyParts = [`itemcount=${installedMods.length}`];
    installedMods.forEach((mod, index) => {
      bodyParts.push(`publishedfileids[${index}]=${mod.workshopId}`);
    });

    const response = await fetch(
      "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bodyParts.join("&"),
      },
    );

    const data = (await response.json()) as {
      response?: {
        publishedfiledetails?: Array<{
          publishedfileid: string;
          result: number;
          time_updated?: number;
        }>;
      };
    };

    const details = data?.response?.publishedfiledetails;
    if (!details) return [];

    const updatedMods: { modId: number; workshopId: string; name: string }[] =
      [];

    for (const detail of details) {
      if (detail.result !== 1 || !detail.time_updated) continue;

      const mod = installedMods.find(
        (m) => m.workshopId === detail.publishedfileid,
      );
      if (!mod) continue;

      const workshopTime = new Date(detail.time_updated * 1000);

      // Compare against workshop_updated_at (the stored workshop timestamp from last install)
      // Falls back to installed_at if no workshop timestamp stored
      const referenceTime = mod.workshopUpdatedAt || mod.installedAt;
      if (!referenceTime) continue;

      const localTime = new Date(referenceTime);

      if (workshopTime > localTime) {
        updatedMods.push({
          modId: mod.id,
          workshopId: mod.workshopId,
          name: mod.name,
        });
      }
    }

    return updatedMods;
  } catch (error) {
    logger.error(
      `[ModManager] Failed to check mod updates for server ${serverId}:`,
      error,
    );
    return [];
  }
}
