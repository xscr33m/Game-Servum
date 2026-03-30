/**
 * Player Tracker Service
 *
 * Tracks player connections using two strategies:
 *
 * 1. **RCON polling (primary)** — Connects via the game's RCON protocol and polls
 *    every 15 seconds. Gives reliable live state regardless of file locks.
 *
 * 2. **Log parsing (historical)** — On startup, delegates to the game adapter
 *    to backfill player history from game-specific log files (e.g. DayZ ADM logs).
 *
 * The RCON approach compares each poll snapshot against the previous one to
 * detect connect/disconnect events, records them in the DB, and broadcasts
 * via WebSocket.
 */

import { broadcast, logger } from "../index.js";
import {
  recordPlayerConnect,
  recordPlayerDisconnect,
  disconnectAllPlayers,
  getOnlinePlayers,
  lookupCharacterId,
  lookupSteam64Id,
} from "../db/index.js";
import { createRconClient, type RconClient } from "../core/rcon/index.js";
import { getGameAdapter } from "../games/index.js";
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

const POLL_INTERVAL_MS = 30000; // 30 seconds
const RCON_RECONNECT_DELAY_MS = 30000; // 30 seconds
const RCON_CONNECT_DELAY_MS = 30000; // Fallback: wait 30s when no startup pattern defined
const CHARACTER_ID_SYNC_INTERVAL = 5; // Sync character IDs every N polls

// Servers waiting for a startup-complete signal before connecting RCON
const pendingReadyServers = new Set<number>();

/**
 * Get cached count of online players for a server
 */
export function getOnlinePlayerCount(serverId: number): number {
  return getOnlinePlayers(serverId).length;
}

/**
 * Notify that a server has finished starting (detected via stdout log pattern).
 * Triggers RCON connection for servers waiting for the startup-complete signal.
 */
export function notifyServerReady(serverId: number): void {
  if (!pendingReadyServers.has(serverId)) return;
  pendingReadyServers.delete(serverId);

  const info = serverInfo.get(serverId);
  if (info) {
    logger.info(
      `[PlayerTracker] Server ${serverId} startup complete, connecting RCON now`,
    );
    connectRcon(serverId, info.installPath, info.port, info.rconConfig);
  }
}

/**
 * Start player tracking for a server.
 * Backfills history from logs if the adapter supports it, then connects via RCON for live tracking.
 */
export function startPlayerTracking(
  serverId: number,
  installPath: string,
  gamePort = 2302,
  rconConfig?: { password: string; port: number },
  /** When true, skip startup pattern wait (server already running, e.g. restored after agent restart) */
  alreadyRunning = false,
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

  // Game-specific: Try to backfill history from logs if adapter supports it
  const adapter = getGameAdapter(gameId);
  if (adapter?.parseServerLogs) {
    adapter.parseServerLogs(serverId, installPath);
  }

  // Reset all sessions to offline after backfill.
  // ADM logs use base64 player IDs while RCON uses hex BattlEye GUIDs — these are
  // different identifiers, so backfill-created "online" sessions would never get
  // closed by RCON disconnect events. RCON polling will establish the true live state.
  disconnectAllPlayers(serverId);

  // Step 2: Connect to RCON — either wait for startup-complete signal or use fixed delay.
  // For freshly started servers with a startup pattern, wait for the log signal.
  // For restored servers (already running), always use the fixed delay.
  const hasStartupPattern =
    !alreadyRunning &&
    server != null &&
    adapter?.getStartupDetector(server) !== null;
  if (hasStartupPattern) {
    logger.info(
      `[PlayerTracker] Waiting for startup-complete signal before connecting RCON for server ${serverId}`,
    );
    pendingReadyServers.add(serverId);
  } else {
    logger.info(
      `[PlayerTracker] Will connect RCON in ${RCON_CONNECT_DELAY_MS / 1000}s for server ${serverId}`,
    );
    const connectTimer = setTimeout(() => {
      reconnectTimers.delete(serverId);
      connectRcon(serverId, installPath, gamePort, rconConfig);
    }, RCON_CONNECT_DELAY_MS);

    reconnectTimers.set(serverId, connectTimer);
  }
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
  pendingReadyServers.delete(serverId);
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
  const adapter = getGameAdapter(gameId);
  const rconProtocol = adapter?.definition.capabilities.rcon;

  if (!rconProtocol) {
    logger.warn(
      `[PlayerTracker] Game ${gameId} does not support RCON, tracking unavailable for server ${serverId}`,
    );
    return;
  }

  // Resolve RCON connection config using adapter
  const server = dbGetServerById(serverId);
  const config =
    rconConfig || (server && adapter ? adapter.readRconConfig(server) : null);
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
      if (rcon.isConnected() && serverInfo.has(serverId)) {
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

    const info = serverInfo.get(serverId);

    // Correct player names from game logs when RCON mangles encoding (e.g. ARK)
    if (info) {
      const adapter = getGameAdapter(info.gameId);
      if (adapter?.resolvePlayerNames) {
        adapter.resolvePlayerNames(currentMap, info.installPath);
      }
    }

    const previousMap =
      lastKnownPlayers.get(serverId) || new Map<string, string>();

    // Detect new connections (in current but not in previous)
    for (const [playerId, name] of currentMap) {
      if (!previousMap.has(playerId)) {
        // Try to find the character ID and Steam64 ID from previous sessions or logs
        const characterId = lookupCharacterId(serverId, name);
        const steam64Id = lookupSteam64Id(serverId, name);
        logger.info(
          `[PlayerTracker] Player connected: ${name} (${playerId}${characterId ? `, charId=${characterId}` : ""}${steam64Id ? `, steam64=${steam64Id}` : ""}) on server ${serverId}`,
        );
        recordPlayerConnect(
          serverId,
          playerId,
          name,
          undefined,
          characterId || undefined,
          steam64Id || undefined,
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

    // Game-specific: Periodically try to sync player data from logs
    if (info) {
      const adapter = getGameAdapter(info.gameId);
      if (adapter?.syncPlayerDataFromLogs) {
        const counter = (pollCounters.get(serverId) || 0) + 1;
        pollCounters.set(serverId, counter);
        if (counter % CHARACTER_ID_SYNC_INTERVAL === 0) {
          adapter.syncPlayerDataFromLogs(serverId, info.installPath);
        }
      }
    }
  } catch (error) {
    // Only log poll errors if the server is still being tracked (not during shutdown)
    if (serverInfo.has(serverId)) {
      logger.error(
        `[PlayerTracker] RCON poll failed for server ${serverId}:`,
        (error as Error).message,
      );
    }
  }
}
