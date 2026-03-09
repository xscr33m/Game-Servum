/**
 * Player Tracker Service
 *
 * Tracks player connections using two strategies:
 *
 * 1. **RCON polling (primary)** — Connects to BattlEye RCON and polls `players`
 *    command every 15 seconds. Gives reliable live state regardless of file locks.
 *
 * 2. **ADM log parsing (historical)** — On startup, parses the latest ADM log
 *    to backfill player history (sessions, playtime). Log files are often locked
 *    while the DayZ server runs, so this only works reliably at startup.
 *
 * The RCON approach compares each poll snapshot against the previous one to
 * detect connect/disconnect events, records them in the DB, and broadcasts
 * via WebSocket.
 */

import path from "path";
import fs from "fs";
import { broadcast, logger } from "../index.js";
import {
  recordPlayerConnect,
  recordPlayerDisconnect,
  disconnectAllPlayers,
  getOnlinePlayers,
  lookupCharacterId,
  updateCharacterIds,
} from "../db/index.js";
import { createRconClient, type RconClient } from "./rcon/index.js";
import { getGameDefinition } from "./gameDefinitions.js";
import { getServerById as dbGetServerById } from "../db/index.js";

// Active RCON connections per server
const rconConnections = new Map<number, RconClient>();

/**
 * Get an active RCON connection for a server (used by scheduler for in-game warnings)
 */
export function getRconConnection(serverId: number): RconClient | undefined {
  return rconConnections.get(serverId);
}

// Polling intervals per server
const pollingIntervals = new Map<number, ReturnType<typeof setInterval>>();

// Last known player set per server (guid -> playerName) for diff detection
const lastKnownPlayers = new Map<number, Map<string, string>>();

// RCON reconnect timers
const reconnectTimers = new Map<number, ReturnType<typeof setTimeout>>();

// Server info needed for reconnection
const serverInfo = new Map<
  number,
  {
    installPath: string;
    port: number;
    gameId: string;
    rconConfig?: { password: string; port: number };
  }
>();

// Poll counter per server (for periodic character ID sync)
const pollCounters = new Map<number, number>();

const POLL_INTERVAL_MS = 15000; // 15 seconds
const RCON_RECONNECT_DELAY_MS = 30000; // 30 seconds
const RCON_CONNECT_DELAY_MS = 15000; // Wait 15s after server start before first RCON connect
const CHARACTER_ID_SYNC_INTERVAL = 5; // Sync character IDs every N polls

/**
 * Read BattlEye RCon config from the server's profiles directory
 */
export function readBattlEyeConfig(
  installPath: string,
  profilesPath?: string,
): { password: string; port: number } | null {
  // Resolve the profiles path (may be relative or absolute)
  const resolvedProfiles = profilesPath
    ? path.isAbsolute(profilesPath)
      ? profilesPath
      : path.join(installPath, profilesPath)
    : path.join(installPath, "profiles");

  // Check multiple possible BattlEye config locations
  const possiblePaths = [
    path.join(resolvedProfiles, "BattlEye", "BEServer_x64.cfg"),
    path.join(installPath, "battleye", "BEServer_x64.cfg"),
    path.join(installPath, "BattlEye", "BEServer_x64.cfg"),
  ];

  for (const cfgPath of possiblePaths) {
    if (fs.existsSync(cfgPath)) {
      try {
        const content = fs.readFileSync(cfgPath, "utf-8");
        const passwordMatch = content.match(/^RConPassword\s+(.+)$/m);
        const portMatch = content.match(/^RConPort\s+(\d+)$/m);

        if (passwordMatch) {
          return {
            password: passwordMatch[1].trim(),
            port: portMatch ? parseInt(portMatch[1].trim(), 10) : 2306,
          };
        }
      } catch (error) {
        logger.error(
          `[PlayerTracker] Error reading BattlEye config ${cfgPath}:`,
          error,
        );
      }
    }
  }

  return null;
}

/**
 * Start player tracking for a server.
 * For DayZ: backfills history from ADM logs, then connects via RCON for live tracking.
 * For other games: connects via appropriate RCON protocol for live tracking.
 */
export function startPlayerTracking(
  serverId: number,
  installPath: string,
  gamePort = 2302,
  rconConfig?: { password: string; port: number },
): void {
  // Stop any existing tracking
  stopPlayerTracking(serverId);

  // Look up the game ID for this server
  const server = dbGetServerById(serverId);
  const gameId = server?.gameId || "dayz";

  logger.info(
    `[PlayerTracker] Starting tracking for server ${serverId} (${gameId})`,
  );

  // Store server info for reconnection (including pre-read RCON config)
  serverInfo.set(serverId, { installPath, port: gamePort, gameId, rconConfig });

  // Initialize player state
  lastKnownPlayers.set(serverId, new Map());

  // DayZ-specific: Try to backfill history from ADM logs (best effort, files may be locked)
  const gameDef = getGameDefinition(gameId);
  if (gameDef?.capabilities.logParsing) {
    backfillFromLogs(serverId, installPath);
  }

  // Reset all sessions to offline after backfill.
  // ADM logs use base64 player IDs while RCON uses hex BattlEye GUIDs — these are
  // different identifiers, so backfill-created "online" sessions would never get
  // closed by RCON disconnect events. RCON polling will establish the true live state.
  disconnectAllPlayers(serverId);

  // Step 2: Connect to RCON with a delay (server needs time to start BattlEye)
  logger.info(
    `[PlayerTracker] Will connect RCON in ${RCON_CONNECT_DELAY_MS / 1000}s for server ${serverId}`,
  );
  const connectTimer = setTimeout(() => {
    reconnectTimers.delete(serverId);
    connectRcon(serverId, installPath, gamePort, rconConfig);
  }, RCON_CONNECT_DELAY_MS);

  reconnectTimers.set(serverId, connectTimer);
}

/**
 * Stop all tracking for a server (RCON + polling)
 */
export function stopPlayerTracking(serverId: number): void {
  // Stop polling
  const interval = pollingIntervals.get(serverId);
  if (interval) {
    clearInterval(interval);
    pollingIntervals.delete(serverId);
  }

  // Cancel pending reconnect
  const timer = reconnectTimers.get(serverId);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(serverId);
  }

  // Disconnect RCON
  const rcon = rconConnections.get(serverId);
  if (rcon) {
    rcon.disconnect();
    rconConnections.delete(serverId);
  }

  // Mark all players as offline in DB
  disconnectAllPlayers(serverId);
  lastKnownPlayers.delete(serverId);
  pollCounters.delete(serverId);
  serverInfo.delete(serverId);

  logger.info(`[PlayerTracker] Stopped tracking for server ${serverId}`);
}

/**
 * Connect to RCON and start polling.
 * Supports BattlEye (DayZ), Telnet (7DTD), and Source RCON (ARK).
 */
async function connectRcon(
  serverId: number,
  installPath: string,
  gamePort: number,
  rconConfig?: { password: string; port: number },
): Promise<void> {
  const info = serverInfo.get(serverId);
  const gameId = info?.gameId || "dayz";
  const gameDef = getGameDefinition(gameId);
  const rconProtocol = gameDef?.capabilities.rcon;

  if (!rconProtocol) {
    logger.warn(
      `[PlayerTracker] Game ${gameId} does not support RCON, tracking unavailable for server ${serverId}`,
    );
    return;
  }

  // Resolve RCON connection config
  const config =
    rconConfig ||
    (rconProtocol === "battleye" ? readBattlEyeConfig(installPath) : null);
  if (!config) {
    logger.warn(
      `[PlayerTracker] No RCON config found for server ${serverId} (${gameId}), RCON tracking unavailable`,
    );
    return;
  }

  const rcon = createRconClient(rconProtocol, {
    host: "127.0.0.1",
    port: config.port,
    password: config.password,
  });

  try {
    logger.info(
      `[PlayerTracker] Connecting ${rconProtocol} RCON to 127.0.0.1:${config.port} for server ${serverId}...`,
    );
    const success = await rcon.connect();

    if (!success) {
      logger.error(
        `[PlayerTracker] RCON authentication failed for server ${serverId}`,
      );
      rcon.disconnect();
      scheduleReconnect(serverId);
      return;
    }

    logger.info(`[PlayerTracker] RCON connected for server ${serverId}`);
    rconConnections.set(serverId, rcon);

    // Handle RCON disconnect → schedule reconnect
    rcon.onClose(() => {
      logger.info(`[PlayerTracker] RCON disconnected for server ${serverId}`);
      rconConnections.delete(serverId);

      // Stop polling
      const interval = pollingIntervals.get(serverId);
      if (interval) {
        clearInterval(interval);
        pollingIntervals.delete(serverId);
      }

      // Only reconnect if we haven't been explicitly stopped
      if (serverInfo.has(serverId)) {
        scheduleReconnect(serverId);
      }
    });

    // Do an initial poll immediately
    await pollPlayers(serverId, rcon);

    // Start periodic polling
    const interval = setInterval(async () => {
      if (rcon.isConnected()) {
        await pollPlayers(serverId, rcon);
      }
    }, POLL_INTERVAL_MS);

    pollingIntervals.set(serverId, interval);
  } catch (error) {
    logger.error(
      `[PlayerTracker] RCON connection failed for server ${serverId}:`,
      (error as Error).message,
    );
    rcon.disconnect();
    scheduleReconnect(serverId);
  }
}

/**
 * Schedule an RCON reconnection attempt
 */
function scheduleReconnect(serverId: number): void {
  // Don't schedule if already pending or server was stopped
  if (reconnectTimers.has(serverId) || !serverInfo.has(serverId)) return;

  logger.info(
    `[PlayerTracker] Scheduling RCON reconnect in ${RCON_RECONNECT_DELAY_MS / 1000}s for server ${serverId}`,
  );

  const timer = setTimeout(() => {
    reconnectTimers.delete(serverId);
    const info = serverInfo.get(serverId);
    if (info) {
      connectRcon(serverId, info.installPath, info.port, info.rconConfig);
    }
  }, RCON_RECONNECT_DELAY_MS);

  reconnectTimers.set(serverId, timer);
}

/**
 * Poll RCON for current players and detect connect/disconnect events
 */
async function pollPlayers(serverId: number, rcon: RconClient): Promise<void> {
  try {
    const currentPlayers = await rcon.getPlayers();
    const currentMap = new Map<string, string>();

    for (const player of currentPlayers) {
      currentMap.set(player.id, player.name);
    }

    const previousMap =
      lastKnownPlayers.get(serverId) || new Map<string, string>();

    // Detect new connections (in current but not in previous)
    for (const [playerId, name] of currentMap) {
      if (!previousMap.has(playerId)) {
        // Try to find the character ID from previous sessions or ADM logs
        const characterId = lookupCharacterId(serverId, name);
        logger.info(
          `[PlayerTracker] Player connected: ${name} (${playerId}${characterId ? `, charId=${characterId}` : ""}) on server ${serverId}`,
        );
        recordPlayerConnect(
          serverId,
          playerId,
          name,
          undefined,
          characterId || undefined,
        );
        broadcast("player:connected", {
          serverId,
          steamId: playerId,
          playerName: name,
          characterId,
        });
      }
    }

    // Detect disconnections (in previous but not in current)
    for (const [playerId, name] of previousMap) {
      if (!currentMap.has(playerId)) {
        logger.info(
          `[PlayerTracker] Player disconnected: ${name} (${playerId}) on server ${serverId}`,
        );
        recordPlayerDisconnect(serverId, playerId);
        broadcast("player:disconnected", {
          serverId,
          steamId: playerId,
          playerName: name,
        });
      }
    }

    lastKnownPlayers.set(serverId, currentMap);

    // DayZ-specific: Periodically try to sync character IDs from ADM logs
    const info = serverInfo.get(serverId);
    const gameDef = info ? getGameDefinition(info.gameId) : null;
    if (gameDef?.capabilities.logParsing) {
      const counter = (pollCounters.get(serverId) || 0) + 1;
      pollCounters.set(serverId, counter);
      if (counter % CHARACTER_ID_SYNC_INTERVAL === 0 && info) {
        syncCharacterIdsFromLog(serverId, info.installPath);
      }
    }
  } catch (error) {
    logger.error(
      `[PlayerTracker] RCON poll failed for server ${serverId}:`,
      (error as Error).message,
    );
  }
}

/**
 * Backfill player history from ADM log files (best effort).
 * Reads the latest ADM log file to populate session history.
 * This may fail if the file is locked by the DayZ server — that's OK,
 * RCON will handle live tracking.
 */
function backfillFromLogs(serverId: number, installPath: string): void {
  const profilesPath = path.join(installPath, "profiles");
  if (!fs.existsSync(profilesPath)) return;

  const admFile = findLatestAdmFile(profilesPath);
  if (!admFile) return;

  try {
    const content = fs.readFileSync(admFile, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    logger.info(
      `[PlayerTracker] Backfilling from ${path.basename(admFile)} (${lines.length} lines)`,
    );

    let connectCount = 0;
    let disconnectCount = 0;

    for (const line of lines) {
      // Player connected
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

      // Player disconnected (with ID)
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
        `[PlayerTracker] Backfill complete: ${connectCount} connects, ${disconnectCount} disconnects`,
      );
    }
  } catch (error) {
    // File may be locked by DayZ server — this is expected
    logger.debug(
      `[PlayerTracker] Could not read ADM log (may be locked): ${(error as Error).message}`,
    );
  }
}

/**
 * Find the most recent .ADM file in the profiles directory
 */
function findLatestAdmFile(profilesPath: string): string | null {
  try {
    const files = fs
      .readdirSync(profilesPath)
      .filter((f) => f.endsWith(".ADM"));

    if (files.length === 0) return null;

    // Sort by filename (contains timestamp), newest last
    // Format: DayZServer_x64_YYYY-MM-DD_HH-MM-SS.ADM
    files.sort();
    return path.join(profilesPath, files[files.length - 1]);
  } catch {
    return null;
  }
}

/**
 * Get cached count of online players for a server
 */
export function getOnlinePlayerCount(serverId: number): number {
  return getOnlinePlayers(serverId).length;
}

/**
 * Extract character ID mappings from the latest ADM log file.
 * Returns a Map of playerName → characterId (44-char base64 ID).
 */
export function extractCharacterIdsFromLog(
  installPath: string,
): Map<string, string> {
  const mappings = new Map<string, string>();
  const profilesPath = path.join(installPath, "profiles");
  if (!fs.existsSync(profilesPath)) return mappings;

  const admFile = findLatestAdmFile(profilesPath);
  if (!admFile) return mappings;

  try {
    const content = fs.readFileSync(admFile, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      // Match any line containing a player ID: Player "Name"(id=XXXXX...)
      const match = line.match(/Player "(.+?)"\s*\(id=([A-Za-z0-9+/=]{20,})/);
      if (match) {
        mappings.set(match[1], match[2]);
      }
    }
  } catch {
    // File may be locked — this is expected during server runtime
  }

  return mappings;
}

/**
 * Sync character IDs from the current ADM log into player_sessions
 * that are missing them. Called periodically during RCON polling.
 */
function syncCharacterIdsFromLog(serverId: number, installPath: string): void {
  const mappings = extractCharacterIdsFromLog(installPath);
  if (mappings.size === 0) return;

  const updated = updateCharacterIds(serverId, mappings);
  if (updated > 0) {
    logger.info(
      `[PlayerTracker] Synced ${updated} character IDs from ADM log for server ${serverId}`,
    );
  }
}
