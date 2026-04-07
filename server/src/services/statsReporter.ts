/**
 * Stats Reporter Service
 *
 * Opt-in periodic service that reports anonymous, cumulative usage statistics
 * to the central aggregation API. Disabled by default — user must explicitly
 * enable in Commander Settings.
 *
 * Flow:
 * 1. User enables stats → agent generates UUID, registers with API, receives token
 * 2. Every 12 hours, agent collects stats and POSTs to /report
 * 3. User disables stats → agent deregisters and clears stored credentials
 */

import crypto from "crypto";
import {
  getAppSetting,
  setAppSetting,
  getAllServers,
  getModsByServerId,
  getDb,
} from "../db/index.js";
import { logger } from "../core/logger.js";
import {
  APP_VERSION,
  STATS_API_BASE_URL,
  STATS_REPORT_INTERVAL_HOURS,
} from "@game-servum/shared";

// ── Module State ────────────────────────────────────────────────────────

let reportTimer: ReturnType<typeof setInterval> | null = null;

// ── Token Derivation ────────────────────────────────────────────────────

/**
 * Derive the app_token for API registration.
 * app_token = HMAC-SHA256(agent_id, SHA256("game-servum-stats-v" + MAJOR_VERSION))
 */
function deriveAppToken(agentId: string): string {
  const majorVersion = APP_VERSION.split(".")[0] ?? "0";
  const secretKey = crypto
    .createHash("sha256")
    .update(`game-servum-stats-v${majorVersion}`)
    .digest();
  return crypto.createHmac("sha256", secretKey).update(agentId).digest("hex");
}

// ── Stats Collection ────────────────────────────────────────────────────

interface StatsPayload {
  servers_total: number;
  servers_by_game: Record<string, number>;
  mods_total: number;
  players_total: number;
}

function collectStats(): StatsPayload {
  const servers = getAllServers();

  // Cumulative server count (from counter, not current list)
  const serversCreatedTotal = parseInt(
    getAppSetting("stats_servers_created_total") ?? "0",
    10,
  );
  // Use MAX of counter vs. current server list (in case counter wasn't there before)
  const serversTotal = Math.max(serversCreatedTotal, servers.length);

  // Snapshot: server count per game
  const serversByGame: Record<string, number> = {};
  for (const server of servers) {
    serversByGame[server.gameId] = (serversByGame[server.gameId] ?? 0) + 1;
  }

  // Cumulative mod count (from counter)
  const modsInstalledTotal = parseInt(
    getAppSetting("stats_mods_installed_total") ?? "0",
    10,
  );
  // Use MAX of counter vs. current installed mods count
  let currentModsCount = 0;
  for (const server of servers) {
    const mods = getModsByServerId(server.id);
    currentModsCount += mods.filter((m) => m.status === "installed").length;
  }
  const modsTotal = Math.max(modsInstalledTotal, currentModsCount);

  // Cumulative unique player count
  const playerResult = getDb().exec(
    "SELECT COUNT(DISTINCT COALESCE(character_id, steam_id)) FROM player_sessions",
  );
  const playersTotal =
    playerResult.length > 0 && playerResult[0].values.length > 0
      ? (playerResult[0].values[0][0] as number)
      : 0;

  return {
    servers_total: serversTotal,
    servers_by_game: serversByGame,
    mods_total: modsTotal,
    players_total: playersTotal,
  };
}

// ── API Communication ───────────────────────────────────────────────────

async function registerAgent(agentId: string): Promise<string | null> {
  const appToken = deriveAppToken(agentId);

  try {
    const response = await fetch(`${STATS_API_BASE_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: agentId,
        agent_version: APP_VERSION,
        app_token: appToken,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      logger.warn(
        `[StatsReporter] Registration failed: ${response.status} — ${body.error ?? "Unknown error"}`,
      );
      return null;
    }

    const data = (await response.json()) as { token: string };
    return data.token;
  } catch (err) {
    logger.warn(
      `[StatsReporter] Registration error: ${(err as Error).message}`,
    );
    return null;
  }
}

async function reportStats(agentId: string, token: string): Promise<boolean> {
  const stats = collectStats();

  try {
    const response = await fetch(`${STATS_API_BASE_URL}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        agent_id: agentId,
        agent_version: APP_VERSION,
        stats,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      logger.warn(
        `[StatsReporter] Report failed: ${response.status} — ${body.error ?? "Unknown error"}`,
      );
      return false;
    }

    logger.info("[StatsReporter] Stats reported successfully");
    return true;
  } catch (err) {
    logger.warn(`[StatsReporter] Report error: ${(err as Error).message}`);
    return false;
  }
}

async function deregisterAgent(agentId: string, token: string): Promise<void> {
  try {
    await fetch(`${STATS_API_BASE_URL}/deregister`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ agent_id: agentId }),
    });
    logger.info("[StatsReporter] Agent deregistered");
  } catch {
    // Best-effort — don't block disable flow
    logger.warn("[StatsReporter] Deregistration failed (best-effort)");
  }
}

// ── Timer Management ────────────────────────────────────────────────────

function startReportTimer(): void {
  stopReportTimer();

  const intervalMs = STATS_REPORT_INTERVAL_HOURS * 60 * 60 * 1000;

  // Initial report after 60 seconds
  setTimeout(() => {
    doReport().catch(() => {});
  }, 60_000);

  // Periodic reports
  reportTimer = setInterval(() => {
    doReport().catch(() => {});
  }, intervalMs);

  logger.info(
    `[StatsReporter] Report timer started (every ${STATS_REPORT_INTERVAL_HOURS}h)`,
  );
}

function stopReportTimer(): void {
  if (reportTimer) {
    clearInterval(reportTimer);
    reportTimer = null;
  }
}

async function doReport(): Promise<void> {
  const agentId = getAppSetting("stats_agent_uuid");
  const token = getAppSetting("stats_auth_token");

  if (!agentId || !token) {
    logger.warn(
      "[StatsReporter] Cannot report — missing agent UUID or auth token",
    );
    return;
  }

  const success = await reportStats(agentId, token);

  // If auth failed (token expired), try re-registering
  if (!success) {
    logger.info("[StatsReporter] Attempting re-registration...");
    const newToken = await registerAgent(agentId);
    if (newToken) {
      setAppSetting("stats_auth_token", newToken);
      await reportStats(agentId, newToken);
    }
  }
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Initialize the stats reporter on server startup.
 * Starts the report timer only if stats collection is enabled.
 */
export function initStatsReporter(): void {
  const enabled = getAppSetting("stats_collection_enabled") === "true";
  if (!enabled) {
    logger.debug("[StatsReporter] Stats collection is disabled");
    return;
  }

  const agentId = getAppSetting("stats_agent_uuid");
  const token = getAppSetting("stats_auth_token");

  if (!agentId || !token) {
    logger.warn("[StatsReporter] Enabled but missing credentials — disabling");
    setAppSetting("stats_collection_enabled", "false");
    return;
  }

  startReportTimer();
}

/**
 * Stop the stats reporter (called during graceful shutdown).
 */
export function stopStatsReporter(): void {
  stopReportTimer();
}

/**
 * Enable stats collection: generate UUID, register with API, start timer.
 */
export async function enableStatsCollection(): Promise<{
  success: boolean;
  message: string;
}> {
  // Generate UUID if not already set
  let agentId = getAppSetting("stats_agent_uuid");
  if (!agentId) {
    agentId = crypto.randomUUID();
    setAppSetting("stats_agent_uuid", agentId);
    logger.info(`[StatsReporter] Generated agent UUID: ${agentId}`);
  }

  // Register with the aggregation API
  const token = await registerAgent(agentId);
  if (!token) {
    return {
      success: false,
      message: "Failed to register with stats API — try again later",
    };
  }

  setAppSetting("stats_auth_token", token);
  setAppSetting("stats_collection_enabled", "true");
  startReportTimer();

  logger.info("[StatsReporter] Stats collection enabled");
  return { success: true, message: "Anonymous stats collection enabled" };
}

/**
 * Disable stats collection: stop timer, deregister, clear token.
 */
export async function disableStatsCollection(): Promise<{
  success: boolean;
  message: string;
}> {
  stopReportTimer();

  const agentId = getAppSetting("stats_agent_uuid");
  const token = getAppSetting("stats_auth_token");

  // Deregister (best-effort)
  if (agentId && token) {
    await deregisterAgent(agentId, token);
  }

  setAppSetting("stats_collection_enabled", "false");
  setAppSetting("stats_auth_token", "");

  logger.info("[StatsReporter] Stats collection disabled");
  return { success: true, message: "Anonymous stats collection disabled" };
}

/**
 * Get current stats settings for the API.
 */
export function getStatsSettings(): {
  enabled: boolean;
  agentId: string | null;
} {
  return {
    enabled: getAppSetting("stats_collection_enabled") === "true",
    agentId: getAppSetting("stats_agent_uuid"),
  };
}
