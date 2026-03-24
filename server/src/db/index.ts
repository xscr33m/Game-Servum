import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import path from "path";
import fs from "fs";
import { getConfig } from "../services/config.js";
import { logger } from "../index.js";
import { runMigrations } from "./migrations.js";
import type {
  GameServer,
  SteamConfig,
  ServerMod,
  PlayerSession,
  PlayerSummary,
  LogSettings,
  ServerSchedule,
  ServerMessage,
  ServerVariable,
  UpdateRestartSettings,
  BackupMetadata,
  BackupSettings,
} from "../types/index.js";

let db: SqlJsDatabase;
let dbPath: string;

export async function initDatabase(): Promise<SqlJsDatabase> {
  const config = getConfig();

  // Ensure data directory exists
  if (!fs.existsSync(config.dataPath)) {
    fs.mkdirSync(config.dataPath, { recursive: true });
  }

  dbPath = path.join(config.dataPath, "gameservum.db");

  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Enable foreign key enforcement (required for ON DELETE CASCADE)
  db.run("PRAGMA foreign_keys = ON");

  // Run all pending migrations (creates tables on fresh DB, upgrades existing)
  const applied = runMigrations(db, (msg) => logger.info(msg));
  if (applied > 0) {
    logger.info(`[DB] ${applied} migration(s) applied`);
  }

  // Insert default steam config if not exists
  const existing = db.exec("SELECT id FROM steam_config WHERE id = 1");
  if (existing.length === 0) {
    db.run("INSERT INTO steam_config (id) VALUES (1)");
  }

  saveDatabase();
  logger.info("Database initialized at:", dbPath);
  return db;
}

export function saveDatabase(): void {
  if (db && dbPath) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

export function getDb(): SqlJsDatabase {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}

// ── API Keys queries ──

export interface ApiKeyRecord {
  id: number;
  keyHash: string;
  passwordHash: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  isActive: boolean;
}

export function createApiKey(
  keyHash: string,
  passwordHash: string,
  name: string,
): void {
  getDb().run(
    "INSERT INTO api_keys (key_hash, password_hash, name) VALUES (?, ?, ?)",
    [keyHash, passwordHash, name],
  );
  saveDatabase();
}

export function findApiKeyByHash(keyHash: string): ApiKeyRecord | null {
  const result = getDb().exec(
    "SELECT id, key_hash, password_hash, name, created_at, last_used_at, is_active FROM api_keys WHERE key_hash = ?",
    [keyHash],
  );

  if (result.length === 0 || result[0].values.length === 0) return null;

  const row = result[0].values[0];
  return {
    id: row[0] as number,
    keyHash: row[1] as string,
    passwordHash: row[2] as string,
    name: row[3] as string,
    createdAt: row[4] as string,
    lastUsedAt: row[5] as string | null,
    isActive: (row[6] as number) === 1,
  };
}

export function findApiKeyById(id: number): ApiKeyRecord | null {
  const result = getDb().exec(
    "SELECT id, key_hash, password_hash, name, created_at, last_used_at, is_active FROM api_keys WHERE id = ?",
    [id],
  );

  if (result.length === 0 || result[0].values.length === 0) return null;

  const row = result[0].values[0];
  return {
    id: row[0] as number,
    keyHash: row[1] as string,
    passwordHash: row[2] as string,
    name: row[3] as string,
    createdAt: row[4] as string,
    lastUsedAt: row[5] as string | null,
    isActive: (row[6] as number) === 1,
  };
}

export function getAllApiKeys(): Omit<
  ApiKeyRecord,
  "keyHash" | "passwordHash"
>[] {
  const result = getDb().exec(
    "SELECT id, name, created_at, last_used_at, is_active FROM api_keys ORDER BY created_at ASC",
  );

  if (result.length === 0) return [];

  return result[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
    name: row[1] as string,
    createdAt: row[2] as string,
    lastUsedAt: row[3] as string | null,
    isActive: (row[4] as number) === 1,
  }));
}

export function updateKeyLastUsed(id: number): void {
  getDb().run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", [
    new Date().toISOString(),
    id,
  ]);
  saveDatabase();
}

export function deleteApiKey(id: number): void {
  getDb().run("DELETE FROM api_keys WHERE id = ?", [id]);
  saveDatabase();
}

export function updateApiKeyPassword(id: number, passwordHash: string): void {
  getDb().run("UPDATE api_keys SET password_hash = ? WHERE id = ?", [
    passwordHash,
    id,
  ]);
  saveDatabase();
}

export function getApiKeyCount(): number {
  const result = getDb().exec(
    "SELECT COUNT(*) FROM api_keys WHERE is_active = 1",
  );
  if (result.length === 0 || result[0].values.length === 0) return 0;
  return result[0].values[0][0] as number;
}

// Steam config queries
export function getSteamConfig(): SteamConfig | null {
  const result = getDb().exec("SELECT * FROM steam_config WHERE id = 1");

  if (result.length === 0 || result[0].values.length === 0) return null;

  const row = result[0].values[0];
  return {
    id: row[0] as number,
    username: row[1] as string | null,
    isLoggedIn: row[2] === 1,
    lastLogin: row[3] as string | null,
  };
}

export function updateSteamConfig(
  username: string | null,
  isLoggedIn: boolean,
): void {
  getDb().run(
    "UPDATE steam_config SET username = ?, is_logged_in = ?, last_login = ? WHERE id = 1",
    [
      username,
      isLoggedIn ? 1 : 0,
      isLoggedIn ? new Date().toISOString() : null,
    ],
  );
  saveDatabase();
}

// Game server queries
export function getAllServers(): GameServer[] {
  const result = getDb().exec(
    `SELECT id, game_id, name, app_id, install_path, executable, launch_params, port, query_port, profiles_path, auto_restart, status, pid, created_at, started_at 
     FROM game_servers ORDER BY created_at ASC`,
  );

  if (result.length === 0) return [];

  return result[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
    gameId: row[1] as string,
    name: row[2] as string,
    appId: row[3] as number,
    installPath: row[4] as string,
    executable: row[5] as string,
    launchParams: row[6] as string | null,
    port: row[7] as number,
    queryPort: row[8] as number | null,
    profilesPath: (row[9] as string | null) || "profiles",
    autoRestart: (row[10] as number) === 1,
    status: row[11] as GameServer["status"],
    pid: row[12] as number | null,
    createdAt: row[13] as string,
    startedAt: (row[14] as string | null) ?? null,
  }));
}

export function getServerById(id: number): GameServer | null {
  const result = getDb().exec(
    `SELECT id, game_id, name, app_id, install_path, executable, launch_params, port, query_port, profiles_path, auto_restart, status, pid, created_at, started_at 
     FROM game_servers WHERE id = ?`,
    [id],
  );

  if (result.length === 0 || result[0].values.length === 0) return null;

  const row = result[0].values[0];
  return {
    id: row[0] as number,
    gameId: row[1] as string,
    name: row[2] as string,
    appId: row[3] as number,
    installPath: row[4] as string,
    executable: row[5] as string,
    launchParams: row[6] as string | null,
    port: row[7] as number,
    queryPort: row[8] as number | null,
    profilesPath: (row[9] as string | null) || "profiles",
    autoRestart: (row[10] as number) === 1,
    status: row[11] as GameServer["status"],
    pid: row[12] as number | null,
    createdAt: row[13] as string,
    startedAt: (row[14] as string | null) ?? null,
  };
}

/**
 * Get all ports currently used by existing servers.
 * Returns an array with server info for port conflict detection.
 */
export function getUsedPorts(): Array<{
  id: number;
  name: string;
  gameId: string;
  port: number;
  queryPort: number | null;
}> {
  const result = getDb().exec(
    "SELECT id, name, game_id, port, query_port FROM game_servers",
  );
  if (result.length === 0) return [];
  return result[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
    name: row[1] as string,
    gameId: row[2] as string,
    port: row[3] as number,
    queryPort: row[4] as number | null,
  }));
}

export function createServer(
  server: Omit<
    GameServer,
    "id" | "status" | "pid" | "createdAt" | "startedAt" | "autoRestart"
  >,
): number {
  getDb().run(
    `INSERT INTO game_servers (game_id, name, app_id, install_path, executable, launch_params, port, query_port, profiles_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      server.gameId,
      server.name,
      server.appId,
      server.installPath,
      server.executable,
      server.launchParams,
      server.port,
      server.queryPort,
      server.profilesPath,
    ],
  );

  const result = getDb().exec("SELECT last_insert_rowid()");
  const lastId = result[0].values[0][0] as number;

  saveDatabase();
  return lastId;
}

export function updateServerStatus(
  id: number,
  status: GameServer["status"],
  pid: number | null = null,
  startedAt: string | null = null,
): void {
  getDb().run(
    "UPDATE game_servers SET status = ?, pid = ?, started_at = ? WHERE id = ?",
    [status, pid, startedAt, id],
  );
  saveDatabase();
}

export function updateServerLaunchParams(
  id: number,
  launchParams: string,
): void {
  getDb().run("UPDATE game_servers SET launch_params = ? WHERE id = ?", [
    launchParams,
    id,
  ]);
  saveDatabase();
}

export function updateServerProfilesPath(
  id: number,
  profilesPath: string,
): void {
  getDb().run("UPDATE game_servers SET profiles_path = ? WHERE id = ?", [
    profilesPath,
    id,
  ]);
  saveDatabase();
}

export function updateServerPorts(
  id: number,
  port: number,
  queryPort: number | null,
): void {
  getDb().run("UPDATE game_servers SET port = ?, query_port = ? WHERE id = ?", [
    port,
    queryPort,
    id,
  ]);
  saveDatabase();
}

export function updateServerName(id: number, name: string): void {
  getDb().run("UPDATE game_servers SET name = ? WHERE id = ?", [name, id]);
  saveDatabase();
}

export function updateServerAutoRestart(
  id: number,
  autoRestart: boolean,
): void {
  getDb().run("UPDATE game_servers SET auto_restart = ? WHERE id = ?", [
    autoRestart ? 1 : 0,
    id,
  ]);
  saveDatabase();
}

export function deleteServer(id: number): void {
  const db = getDb();
  // Explicitly delete all related records (belt-and-suspenders with CASCADE)
  db.run("DELETE FROM update_restart_settings WHERE server_id = ?", [id]);
  db.run("DELETE FROM server_variables WHERE server_id = ?", [id]);
  db.run("DELETE FROM server_messages WHERE server_id = ?", [id]);
  db.run("DELETE FROM server_schedules WHERE server_id = ?", [id]);
  db.run("DELETE FROM log_settings WHERE server_id = ?", [id]);
  db.run("DELETE FROM player_sessions WHERE server_id = ?", [id]);
  db.run("DELETE FROM server_mods WHERE server_id = ?", [id]);
  db.run("DELETE FROM server_backups WHERE server_id = ?", [id]);
  db.run("DELETE FROM backup_settings WHERE server_id = ?", [id]);
  db.run("DELETE FROM game_servers WHERE id = ?", [id]);
  saveDatabase();
}

// Server Mods queries
export function getModsByServerId(serverId: number): ServerMod[] {
  const result = getDb().exec(
    `SELECT id, server_id, workshop_id, name, enabled, is_server_mod, load_order, status, installed_at, workshop_updated_at
     FROM server_mods WHERE server_id = ? ORDER BY load_order ASC`,
    [serverId],
  );

  if (result.length === 0) return [];

  return result[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
    serverId: row[1] as number,
    workshopId: row[2] as string,
    name: row[3] as string,
    enabled: row[4] === 1,
    isServerMod: row[5] === 1,
    loadOrder: row[6] as number,
    status: row[7] as ServerMod["status"],
    installedAt: row[8] as string | null,
    workshopUpdatedAt: row[9] as string | null,
  }));
}

export function getModById(id: number): ServerMod | null {
  const result = getDb().exec(
    `SELECT id, server_id, workshop_id, name, enabled, is_server_mod, load_order, status, installed_at, workshop_updated_at
     FROM server_mods WHERE id = ?`,
    [id],
  );

  if (result.length === 0 || result[0].values.length === 0) return null;

  const row = result[0].values[0];
  return {
    id: row[0] as number,
    serverId: row[1] as number,
    workshopId: row[2] as string,
    name: row[3] as string,
    enabled: row[4] === 1,
    isServerMod: row[5] === 1,
    loadOrder: row[6] as number,
    status: row[7] as ServerMod["status"],
    installedAt: row[8] as string | null,
    workshopUpdatedAt: row[9] as string | null,
  };
}

export function createMod(mod: {
  serverId: number;
  workshopId: string;
  name: string;
  isServerMod?: boolean;
}): number {
  // Get max load order for this server
  const maxOrderResult = getDb().exec(
    "SELECT MAX(load_order) FROM server_mods WHERE server_id = ?",
    [mod.serverId],
  );
  const maxOrder =
    maxOrderResult.length > 0 && maxOrderResult[0].values[0][0] !== null
      ? (maxOrderResult[0].values[0][0] as number)
      : -1;

  getDb().run(
    `INSERT INTO server_mods (server_id, workshop_id, name, is_server_mod, load_order, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [
      mod.serverId,
      mod.workshopId,
      mod.name,
      mod.isServerMod ? 1 : 0,
      maxOrder + 1,
    ],
  );

  const result = getDb().exec("SELECT last_insert_rowid()");
  const lastId = result[0].values[0][0] as number;

  saveDatabase();
  return lastId;
}

export function updateModStatus(
  id: number,
  status: ServerMod["status"],
  name?: string,
): void {
  if (name) {
    getDb().run(
      "UPDATE server_mods SET status = ?, name = ?, installed_at = ? WHERE id = ?",
      [
        status,
        name,
        status === "installed" ? new Date().toISOString() : null,
        id,
      ],
    );
  } else {
    getDb().run(
      "UPDATE server_mods SET status = ?, installed_at = ? WHERE id = ?",
      [status, status === "installed" ? new Date().toISOString() : null, id],
    );
  }
  saveDatabase();
}

export function updateModEnabled(id: number, enabled: boolean): void {
  getDb().run("UPDATE server_mods SET enabled = ? WHERE id = ?", [
    enabled ? 1 : 0,
    id,
  ]);
  saveDatabase();
}

export function updateModLoadOrder(id: number, loadOrder: number): void {
  getDb().run("UPDATE server_mods SET load_order = ? WHERE id = ?", [
    loadOrder,
    id,
  ]);
  saveDatabase();
}

export function deleteMod(id: number): void {
  getDb().run("DELETE FROM server_mods WHERE id = ?", [id]);
  saveDatabase();
}

// Player session queries

/**
 * Record a player connecting to a server
 */
export function recordPlayerConnect(
  serverId: number,
  steamId: string,
  playerName: string,
  connectedAt?: string,
  characterId?: string,
): number {
  const timestamp = connectedAt || new Date().toISOString();

  // Close any stale online sessions for this player on this server
  getDb().run(
    `UPDATE player_sessions SET is_online = 0, disconnected_at = ?
     WHERE server_id = ? AND steam_id = ? AND is_online = 1`,
    [timestamp, serverId, steamId],
  );

  getDb().run(
    `INSERT INTO player_sessions (server_id, steam_id, player_name, character_id, connected_at, is_online)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [serverId, steamId, playerName, characterId || null, timestamp],
  );

  const result = getDb().exec("SELECT last_insert_rowid()");
  const lastId = result[0].values[0][0] as number;

  saveDatabase();
  return lastId;
}

/**
 * Look up the character ID for a player by name from previous sessions
 */
export function lookupCharacterId(
  serverId: number,
  playerName: string,
): string | null {
  const result = getDb().exec(
    `SELECT character_id FROM player_sessions
     WHERE server_id = ? AND player_name = ? AND character_id IS NOT NULL
     ORDER BY connected_at DESC LIMIT 1`,
    [serverId, playerName],
  );

  if (result.length === 0 || result[0].values.length === 0) return null;
  return result[0].values[0][0] as string;
}

/**
 * Bulk update character IDs for sessions matching player names
 */
export function updateCharacterIds(
  serverId: number,
  mappings: Map<string, string>,
): number {
  let updated = 0;
  for (const [playerName, characterId] of mappings) {
    // Check if there are any sessions to update
    const check = getDb().exec(
      `SELECT COUNT(*) FROM player_sessions
       WHERE server_id = ? AND player_name = ? AND character_id IS NULL`,
      [serverId, playerName],
    );
    const count = check.length > 0 ? (check[0].values[0][0] as number) : 0;
    if (count > 0) {
      getDb().run(
        `UPDATE player_sessions SET character_id = ?
         WHERE server_id = ? AND player_name = ? AND character_id IS NULL`,
        [characterId, serverId, playerName],
      );
      updated += count;
    }
  }
  if (updated > 0) saveDatabase();
  return updated;
}

/**
 * Record a player disconnecting from a server
 */
export function recordPlayerDisconnect(
  serverId: number,
  steamId: string,
  disconnectedAt?: string,
): void {
  const timestamp = disconnectedAt || new Date().toISOString();

  getDb().run(
    `UPDATE player_sessions SET is_online = 0, disconnected_at = ?
     WHERE server_id = ? AND steam_id = ? AND is_online = 1`,
    [timestamp, serverId, steamId],
  );

  saveDatabase();
}

/**
 * Mark all players on a server as offline (e.g. when server stops)
 */
export function disconnectAllPlayers(serverId: number): void {
  const timestamp = new Date().toISOString();

  getDb().run(
    `UPDATE player_sessions SET is_online = 0, disconnected_at = ?
     WHERE server_id = ? AND is_online = 1`,
    [timestamp, serverId],
  );

  saveDatabase();
}

/**
 * Get currently online players for a server
 */
export function getOnlinePlayers(serverId: number): PlayerSession[] {
  const result = getDb().exec(
    `SELECT id, server_id, steam_id, player_name, character_id, connected_at, disconnected_at, is_online
     FROM player_sessions
     WHERE server_id = ? AND is_online = 1
     ORDER BY connected_at ASC`,
    [serverId],
  );

  if (result.length === 0) return [];

  return result[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
    serverId: row[1] as number,
    steamId: row[2] as string,
    playerName: row[3] as string,
    characterId: row[4] as string | null,
    connectedAt: row[5] as string,
    disconnectedAt: row[6] as string | null,
    isOnline: row[7] === 1,
  }));
}

/**
 * Get player summaries with total playtime for a server
 */
export function getPlayerSummaries(serverId: number): PlayerSummary[] {
  // Get all unique players for this server with aggregated data.
  // Group by COALESCE(character_id, steam_id) so that sessions from ADM backfill
  // (using character_id as steam_id) and RCON (using BattlEye GUID as steam_id)
  // are merged when both have the same character_id.
  const result = getDb().exec(
    `SELECT
       COALESCE(character_id, steam_id) as primary_id,
       player_name,
       MAX(character_id) as character_id,
       MAX(is_online) as is_online,
       MAX(CASE WHEN is_online = 1 THEN connected_at ELSE NULL END) as current_session_start,
       COUNT(*) as session_count,
       MAX(COALESCE(disconnected_at, connected_at)) as last_seen,
       SUM(
         CASE
           WHEN disconnected_at IS NOT NULL THEN
             CAST((julianday(disconnected_at) - julianday(connected_at)) * 86400 AS INTEGER)
           WHEN is_online = 1 THEN
             CAST((julianday('now') - julianday(connected_at)) * 86400 AS INTEGER)
           ELSE 0
         END
       ) as total_playtime_seconds
     FROM player_sessions
     WHERE server_id = ?
     GROUP BY COALESCE(character_id, steam_id)
     ORDER BY is_online DESC, last_seen DESC`,
    [serverId],
  );

  if (result.length === 0) return [];

  return result[0].values.map((row: unknown[]) => ({
    steamId: row[0] as string,
    playerName: row[1] as string,
    characterId: row[2] as string | null,
    isOnline: (row[3] as number) === 1,
    currentSessionStart: row[4] as string | null,
    sessionCount: row[5] as number,
    lastSeen: row[6] as string,
    totalPlaytimeSeconds: Math.max(0, row[7] as number),
  }));
}

// Log settings queries

/**
 * Get log settings for a server (returns defaults if not configured)
 */
export function getLogSettings(serverId: number): LogSettings {
  const result = getDb().exec(
    `SELECT server_id, archive_on_start, retention_days
     FROM log_settings
     WHERE server_id = ?`,
    [serverId],
  );

  if (result.length === 0 || result[0].values.length === 0) {
    return {
      serverId,
      archiveOnStart: true,
      retentionDays: 30,
    };
  }

  const row = result[0].values[0];
  return {
    serverId: row[0] as number,
    archiveOnStart: row[1] === 1,
    retentionDays: row[2] as number,
  };
}

/**
 * Update log settings for a server (upsert)
 */
export function updateLogSettings(
  serverId: number,
  archiveOnStart: boolean,
  retentionDays: number,
): void {
  getDb().run(
    `INSERT INTO log_settings (server_id, archive_on_start, retention_days)
     VALUES (?, ?, ?)
     ON CONFLICT(server_id) DO UPDATE SET
       archive_on_start = excluded.archive_on_start,
       retention_days = excluded.retention_days`,
    [serverId, archiveOnStart ? 1 : 0, retentionDays],
  );
  saveDatabase();
}

// Server schedule queries
export function getScheduleByServerId(serverId: number): ServerSchedule | null {
  const result = getDb().exec(
    `SELECT id, server_id, interval_hours, warning_minutes, warning_message, enabled, last_restart, next_restart
     FROM server_schedules WHERE server_id = ?`,
    [serverId],
  );

  if (result.length === 0 || result[0].values.length === 0) return null;

  const row = result[0].values[0];
  return {
    id: row[0] as number,
    serverId: row[1] as number,
    intervalHours: row[2] as number,
    warningMinutes: JSON.parse(row[3] as string),
    warningMessage: row[4] as string,
    enabled: (row[5] as number) === 1,
    lastRestart: row[6] as string | null,
    nextRestart: row[7] as string | null,
  };
}

export function upsertSchedule(
  serverId: number,
  intervalHours: number,
  warningMinutes: number[],
  warningMessage: string,
  enabled: boolean,
): ServerSchedule {
  getDb().run(
    `INSERT INTO server_schedules (server_id, interval_hours, warning_minutes, warning_message, enabled)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(server_id) DO UPDATE SET
       interval_hours = excluded.interval_hours,
       warning_minutes = excluded.warning_minutes,
       warning_message = excluded.warning_message,
       enabled = excluded.enabled`,
    [
      serverId,
      intervalHours,
      JSON.stringify(warningMinutes),
      warningMessage,
      enabled ? 1 : 0,
    ],
  );
  saveDatabase();
  return getScheduleByServerId(serverId)!;
}

export function updateScheduleNextRestart(
  serverId: number,
  nextRestart: string | null,
  lastRestart?: string,
): void {
  if (lastRestart) {
    getDb().run(
      "UPDATE server_schedules SET next_restart = ?, last_restart = ? WHERE server_id = ?",
      [nextRestart, lastRestart, serverId],
    );
  } else {
    getDb().run(
      "UPDATE server_schedules SET next_restart = ? WHERE server_id = ?",
      [nextRestart, serverId],
    );
  }
  saveDatabase();
}

export function deleteSchedule(serverId: number): void {
  getDb().run("DELETE FROM server_schedules WHERE server_id = ?", [serverId]);
  saveDatabase();
}

export function getAllEnabledSchedules(): ServerSchedule[] {
  const result = getDb().exec(
    `SELECT id, server_id, interval_hours, warning_minutes, warning_message, enabled, last_restart, next_restart
     FROM server_schedules WHERE enabled = 1`,
  );

  if (result.length === 0) return [];

  return result[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
    serverId: row[1] as number,
    intervalHours: row[2] as number,
    warningMinutes: JSON.parse(row[3] as string),
    warningMessage: row[4] as string,
    enabled: (row[5] as number) === 1,
    lastRestart: row[6] as string | null,
    nextRestart: row[7] as string | null,
  }));
}

// ─── Server Messages (Scheduled RCON broadcasts) ────────────────────────

export function getMessagesByServerId(serverId: number): ServerMessage[] {
  const result = getDb().exec(
    `SELECT id, server_id, message, interval_minutes, enabled, created_at
     FROM server_messages WHERE server_id = ? ORDER BY created_at ASC`,
    [serverId],
  );

  if (result.length === 0) return [];

  return result[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
    serverId: row[1] as number,
    message: row[2] as string,
    intervalMinutes: row[3] as number,
    enabled: (row[4] as number) === 1,
    createdAt: row[5] as string,
  }));
}

export function createMessage(
  serverId: number,
  message: string,
  intervalMinutes: number,
  enabled: boolean,
): ServerMessage {
  getDb().run(
    `INSERT INTO server_messages (server_id, message, interval_minutes, enabled)
     VALUES (?, ?, ?, ?)`,
    [serverId, message, intervalMinutes, enabled ? 1 : 0],
  );
  saveDatabase();

  // Return the newly created message
  const result = getDb().exec("SELECT last_insert_rowid()");
  const newId = result[0].values[0][0] as number;
  return getMessageById(newId)!;
}

export function getMessageById(id: number): ServerMessage | null {
  const result = getDb().exec(
    `SELECT id, server_id, message, interval_minutes, enabled, created_at
     FROM server_messages WHERE id = ?`,
    [id],
  );

  if (result.length === 0 || result[0].values.length === 0) return null;

  const row = result[0].values[0];
  return {
    id: row[0] as number,
    serverId: row[1] as number,
    message: row[2] as string,
    intervalMinutes: row[3] as number,
    enabled: (row[4] as number) === 1,
    createdAt: row[5] as string,
  };
}

export function updateMessage(
  id: number,
  message: string,
  intervalMinutes: number,
  enabled: boolean,
): ServerMessage | null {
  getDb().run(
    `UPDATE server_messages SET message = ?, interval_minutes = ?, enabled = ? WHERE id = ?`,
    [message, intervalMinutes, enabled ? 1 : 0, id],
  );
  saveDatabase();
  return getMessageById(id);
}

export function deleteMessage(id: number): void {
  getDb().run("DELETE FROM server_messages WHERE id = ?", [id]);
  saveDatabase();
}

export function getEnabledMessagesByServerId(
  serverId: number,
): ServerMessage[] {
  const result = getDb().exec(
    `SELECT id, server_id, message, interval_minutes, enabled, created_at
     FROM server_messages WHERE server_id = ? AND enabled = 1 ORDER BY created_at ASC`,
    [serverId],
  );

  if (result.length === 0) return [];

  return result[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
    serverId: row[1] as number,
    message: row[2] as string,
    intervalMinutes: row[3] as number,
    enabled: (row[4] as number) === 1,
    createdAt: row[5] as string,
  }));
}

// ─── Server Variables (Custom template placeholders) ────────────────────

export function getVariablesByServerId(serverId: number): ServerVariable[] {
  const result = getDb().exec(
    `SELECT id, server_id, name, value
     FROM server_variables WHERE server_id = ? ORDER BY name ASC`,
    [serverId],
  );

  if (result.length === 0) return [];

  return result[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
    serverId: row[1] as number,
    name: row[2] as string,
    value: row[3] as string,
  }));
}

export function upsertVariable(
  serverId: number,
  name: string,
  value: string,
): ServerVariable {
  getDb().run(
    `INSERT INTO server_variables (server_id, name, value)
     VALUES (?, ?, ?)
     ON CONFLICT(server_id, name) DO UPDATE SET value = excluded.value`,
    [serverId, name, value],
  );
  saveDatabase();

  const result = getDb().exec(
    `SELECT id, server_id, name, value FROM server_variables WHERE server_id = ? AND name = ?`,
    [serverId, name],
  );
  const row = result[0].values[0];
  return {
    id: row[0] as number,
    serverId: row[1] as number,
    name: row[2] as string,
    value: row[3] as string,
  };
}

export function deleteVariable(id: number): void {
  getDb().run("DELETE FROM server_variables WHERE id = ?", [id]);
  saveDatabase();
}

// ─── Update Restart Settings ────────────────────────────────────────────

export function getUpdateRestartSettings(
  serverId: number,
): UpdateRestartSettings {
  const result = getDb().exec(
    `SELECT server_id, enabled, delay_minutes, warning_minutes, warning_message, check_interval_minutes, check_game_updates
     FROM update_restart_settings WHERE server_id = ?`,
    [serverId],
  );

  if (result.length === 0 || result[0].values.length === 0) {
    return {
      serverId,
      enabled: false,
      delayMinutes: 5,
      warningMinutes: [5, 3, 1],
      warningMessage:
        "Mod update detected! Server restart in {MINUTES} minutes.",
      checkIntervalMinutes: 10,
      checkGameUpdates: true,
    };
  }

  const row = result[0].values[0];
  return {
    serverId: row[0] as number,
    enabled: (row[1] as number) === 1,
    delayMinutes: row[2] as number,
    warningMinutes: JSON.parse(row[3] as string),
    warningMessage: row[4] as string,
    checkIntervalMinutes: row[5] as number,
    checkGameUpdates: (row[6] as number) === 1,
  };
}

export function upsertUpdateRestartSettings(
  serverId: number,
  settings: Omit<UpdateRestartSettings, "serverId">,
): UpdateRestartSettings {
  getDb().run(
    `INSERT INTO update_restart_settings (server_id, enabled, delay_minutes, warning_minutes, warning_message, check_interval_minutes, check_game_updates)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id) DO UPDATE SET
       enabled = excluded.enabled,
       delay_minutes = excluded.delay_minutes,
       warning_minutes = excluded.warning_minutes,
       warning_message = excluded.warning_message,
       check_interval_minutes = excluded.check_interval_minutes,
       check_game_updates = excluded.check_game_updates`,
    [
      serverId,
      settings.enabled ? 1 : 0,
      settings.delayMinutes,
      JSON.stringify(settings.warningMinutes),
      settings.warningMessage,
      settings.checkIntervalMinutes,
      settings.checkGameUpdates ? 1 : 0,
    ],
  );
  saveDatabase();
  return getUpdateRestartSettings(serverId);
}

// ─── App Settings ───────────────────────────────────────────────────────

export function getAppSetting(key: string): string | null {
  const result = getDb().exec("SELECT value FROM app_settings WHERE key = ?", [
    key,
  ]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  return result[0].values[0][0] as string;
}

export function setAppSetting(key: string, value: string): void {
  getDb().run(
    `INSERT INTO app_settings (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
  saveDatabase();
}

// ─── Mod Workshop Timestamp ─────────────────────────────────────────────

export function updateModWorkshopTimestamp(
  modId: number,
  workshopUpdatedAt: string,
): void {
  getDb().run("UPDATE server_mods SET workshop_updated_at = ? WHERE id = ?", [
    workshopUpdatedAt,
    modId,
  ]);
  saveDatabase();
}

export function setModUpdateAvailable(modId: number): void {
  getDb().run(
    "UPDATE server_mods SET status = 'update_available' WHERE id = ? AND status = 'installed'",
    [modId],
  );
  saveDatabase();
}

export function clearModUpdateStatus(modId: number): void {
  getDb().run(
    "UPDATE server_mods SET status = 'installed' WHERE id = ? AND status = 'update_available'",
    [modId],
  );
  saveDatabase();
}

// ─── Backup Records ────────────────────────────────────────────────────

export function createBackupRecord(
  backup: Pick<
    BackupMetadata,
    | "id"
    | "serverId"
    | "gameId"
    | "serverName"
    | "timestamp"
    | "name"
    | "tag"
    | "trigger"
    | "status"
  > & { filePath?: string },
): void {
  getDb().run(
    `INSERT INTO server_backups (id, server_id, game_id, server_name, timestamp, name, tag, trigger_type, status, file_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      backup.id,
      backup.serverId,
      backup.gameId,
      backup.serverName,
      backup.timestamp,
      backup.name ?? null,
      backup.tag ?? null,
      backup.trigger,
      backup.status,
      backup.filePath ?? null,
    ],
  );
  saveDatabase();
}

export function updateBackupRecord(
  id: string,
  updates: Partial<
    Pick<
      BackupMetadata,
      | "status"
      | "sizeBytes"
      | "fileCount"
      | "durationMs"
      | "errorMessage"
      | "name"
      | "tag"
    >
  >,
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (updates.status !== undefined) {
    sets.push("status = ?");
    params.push(updates.status);
  }
  if (updates.sizeBytes !== undefined) {
    sets.push("size_bytes = ?");
    params.push(updates.sizeBytes);
  }
  if (updates.fileCount !== undefined) {
    sets.push("file_count = ?");
    params.push(updates.fileCount);
  }
  if (updates.durationMs !== undefined) {
    sets.push("duration_ms = ?");
    params.push(updates.durationMs);
  }
  if (updates.errorMessage !== undefined) {
    sets.push("error_message = ?");
    params.push(updates.errorMessage);
  }
  if (updates.name !== undefined) {
    sets.push("name = ?");
    params.push(updates.name);
  }
  if (updates.tag !== undefined) {
    sets.push("tag = ?");
    params.push(updates.tag);
  }
  if (sets.length === 0) return;
  params.push(id);
  getDb().run(
    `UPDATE server_backups SET ${sets.join(", ")} WHERE id = ?`,
    params,
  );
  saveDatabase();
}

export function deleteBackupRecord(id: string): void {
  getDb().run("DELETE FROM server_backups WHERE id = ?", [id]);
  saveDatabase();
}

export function getBackupById(id: string): BackupMetadata | null {
  const result = getDb().exec(
    `SELECT id, server_id, game_id, server_name, timestamp, tag, trigger_type, status, size_bytes, file_count, duration_ms, error_message, file_path, name
     FROM server_backups WHERE id = ?`,
    [id],
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  return mapBackupRow(result[0].values[0]);
}

export function getBackupsByServerId(serverId: number): BackupMetadata[] {
  const result = getDb().exec(
    `SELECT id, server_id, game_id, server_name, timestamp, tag, trigger_type, status, size_bytes, file_count, duration_ms, error_message, file_path, name
     FROM server_backups WHERE server_id = ? ORDER BY timestamp DESC`,
    [serverId],
  );
  if (result.length === 0) return [];
  return result[0].values.map(mapBackupRow);
}

export function deleteBackupsByServerId(serverId: number): void {
  getDb().run("DELETE FROM server_backups WHERE server_id = ?", [serverId]);
  saveDatabase();
}

function mapBackupRow(row: unknown[]): BackupMetadata {
  return {
    id: row[0] as string,
    serverId: row[1] as number,
    gameId: row[2] as string,
    serverName: row[3] as string,
    timestamp: row[4] as string,
    tag: row[5] as string | null,
    trigger: row[6] as BackupMetadata["trigger"],
    status: row[7] as BackupMetadata["status"],
    sizeBytes: row[8] as number | null,
    fileCount: row[9] as number | null,
    durationMs: row[10] as number | null,
    errorMessage: row[11] as string | null,
    name: row[13] as string | null,
  };
}

// ─── Backup Settings ───────────────────────────────────────────────────

export function getBackupSettings(serverId: number): BackupSettings | null {
  const result = getDb().exec(
    `SELECT server_id, enabled, backup_before_restart, backup_before_update, retention_count, retention_days, custom_include_paths, custom_exclude_paths, full_backup, backup_before_start
     FROM backup_settings WHERE server_id = ?`,
    [serverId],
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  const row = result[0].values[0];
  return {
    serverId: row[0] as number,
    enabled: row[1] === 1,
    backupBeforeRestart: row[2] === 1,
    backupBeforeUpdate: row[3] === 1,
    retentionCount: row[4] as number,
    retentionDays: row[5] as number,
    customIncludePaths: JSON.parse((row[6] as string) || "[]"),
    customExcludePaths: JSON.parse((row[7] as string) || "[]"),
    fullBackup: row[8] === 1,
    backupBeforeStart: row[9] === 1,
  };
}

export function upsertBackupSettings(
  serverId: number,
  settings: Partial<Omit<BackupSettings, "serverId">>,
): void {
  const existing = getBackupSettings(serverId);
  if (!existing) {
    getDb().run(
      `INSERT INTO backup_settings (server_id, enabled, full_backup, backup_before_start, backup_before_restart, backup_before_update, retention_count, retention_days, custom_include_paths, custom_exclude_paths)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        serverId,
        settings.enabled ? 1 : 0,
        settings.fullBackup ? 1 : 0,
        settings.backupBeforeStart ? 1 : 0,
        settings.backupBeforeRestart ? 1 : 0,
        settings.backupBeforeUpdate ? 1 : 0,
        settings.retentionCount ?? 5,
        settings.retentionDays ?? 30,
        JSON.stringify(settings.customIncludePaths ?? []),
        JSON.stringify(settings.customExcludePaths ?? []),
      ],
    );
  } else {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (settings.enabled !== undefined) {
      sets.push("enabled = ?");
      params.push(settings.enabled ? 1 : 0);
    }
    if (settings.fullBackup !== undefined) {
      sets.push("full_backup = ?");
      params.push(settings.fullBackup ? 1 : 0);
    }
    if (settings.backupBeforeStart !== undefined) {
      sets.push("backup_before_start = ?");
      params.push(settings.backupBeforeStart ? 1 : 0);
    }
    if (settings.backupBeforeRestart !== undefined) {
      sets.push("backup_before_restart = ?");
      params.push(settings.backupBeforeRestart ? 1 : 0);
    }
    if (settings.backupBeforeUpdate !== undefined) {
      sets.push("backup_before_update = ?");
      params.push(settings.backupBeforeUpdate ? 1 : 0);
    }
    if (settings.retentionCount !== undefined) {
      sets.push("retention_count = ?");
      params.push(settings.retentionCount);
    }
    if (settings.retentionDays !== undefined) {
      sets.push("retention_days = ?");
      params.push(settings.retentionDays);
    }
    if (settings.customIncludePaths !== undefined) {
      sets.push("custom_include_paths = ?");
      params.push(JSON.stringify(settings.customIncludePaths));
    }
    if (settings.customExcludePaths !== undefined) {
      sets.push("custom_exclude_paths = ?");
      params.push(JSON.stringify(settings.customExcludePaths));
    }
    if (sets.length > 0) {
      params.push(serverId);
      getDb().run(
        `UPDATE backup_settings SET ${sets.join(", ")} WHERE server_id = ?`,
        params,
      );
    }
  }
  saveDatabase();
}
