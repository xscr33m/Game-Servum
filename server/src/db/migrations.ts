/**
 * Versioned Database Migration System
 *
 * Each migration has a version number, a name, and an up() function.
 * Migrations are idempotent (safe to re-run) and run in a transaction.
 * The schema_versions table tracks which migrations have been applied.
 *
 * To add a new migration: append an entry to the `migrations` array below.
 */

import type { Database as SqlJsDatabase } from "sql.js";

// ── Types ──────────────────────────────────────────────────────────

interface Migration {
  /** Monotonically increasing version number (must be unique) */
  version: number;
  /** Human-readable name for logging */
  name: string;
  /** Apply the migration. Runs inside BEGIN/COMMIT. */
  up: (db: SqlJsDatabase) => void;
}

// ── Migration Definitions ──────────────────────────────────────────

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS steam_config (
          id INTEGER PRIMARY KEY DEFAULT 1,
          username TEXT,
          is_logged_in INTEGER DEFAULT 0,
          last_login TEXT
        );

        CREATE TABLE IF NOT EXISTS game_servers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id TEXT NOT NULL,
          name TEXT NOT NULL,
          app_id INTEGER NOT NULL,
          install_path TEXT NOT NULL,
          executable TEXT NOT NULL,
          launch_params TEXT,
          port INTEGER DEFAULT 2302,
          query_port INTEGER,
          profiles_path TEXT DEFAULT 'profiles',
          auto_restart INTEGER DEFAULT 0,
          status TEXT DEFAULT 'stopped',
          pid INTEGER,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          started_at TEXT DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS server_mods (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          server_id INTEGER NOT NULL,
          workshop_id TEXT NOT NULL,
          name TEXT NOT NULL,
          enabled INTEGER DEFAULT 1,
          is_server_mod INTEGER DEFAULT 0,
          load_order INTEGER DEFAULT 0,
          status TEXT DEFAULT 'pending',
          installed_at TEXT,
          workshop_updated_at TEXT,
          FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE,
          UNIQUE(server_id, workshop_id)
        );

        CREATE TABLE IF NOT EXISTS player_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          server_id INTEGER NOT NULL,
          steam_id TEXT NOT NULL,
          player_name TEXT NOT NULL,
          character_id TEXT,
          steam64_id TEXT,
          connected_at TEXT NOT NULL,
          disconnected_at TEXT,
          is_online INTEGER DEFAULT 1,
          FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS log_settings (
          server_id INTEGER PRIMARY KEY,
          archive_on_start INTEGER DEFAULT 1,
          retention_days INTEGER DEFAULT 30,
          FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS server_schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          server_id INTEGER NOT NULL UNIQUE,
          interval_hours INTEGER NOT NULL DEFAULT 4,
          warning_minutes TEXT NOT NULL DEFAULT '[15,5,1]',
          warning_message TEXT NOT NULL DEFAULT 'Server restart in {MINUTES} minutes!',
          enabled INTEGER DEFAULT 0,
          last_restart TEXT,
          next_restart TEXT,
          FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS server_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          server_id INTEGER NOT NULL,
          message TEXT NOT NULL,
          interval_minutes INTEGER NOT NULL DEFAULT 30,
          enabled INTEGER DEFAULT 1,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS server_variables (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          server_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          value TEXT NOT NULL DEFAULT '',
          FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE,
          UNIQUE(server_id, name)
        );

        CREATE TABLE IF NOT EXISTS update_restart_settings (
          server_id INTEGER PRIMARY KEY,
          enabled INTEGER DEFAULT 0,
          delay_minutes INTEGER NOT NULL DEFAULT 5,
          warning_minutes TEXT NOT NULL DEFAULT '[5,3,1]',
          warning_message TEXT NOT NULL DEFAULT 'Mod update detected! Server restart in {MINUTES} minutes.',
          check_interval_minutes INTEGER NOT NULL DEFAULT 10,
          check_game_updates INTEGER NOT NULL DEFAULT 1,
          FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS api_keys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key_hash TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT 'Default',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          last_used_at TEXT,
          is_active INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS server_backups (
          id TEXT PRIMARY KEY,
          server_id INTEGER NOT NULL,
          game_id TEXT NOT NULL,
          server_name TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          name TEXT,
          tag TEXT,
          trigger_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          size_bytes INTEGER,
          file_count INTEGER,
          duration_ms INTEGER,
          error_message TEXT,
          file_path TEXT,
          FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS backup_settings (
          server_id INTEGER PRIMARY KEY,
          enabled INTEGER DEFAULT 0,
          full_backup INTEGER DEFAULT 0,
          backup_before_start INTEGER DEFAULT 0,
          backup_before_restart INTEGER DEFAULT 0,
          backup_before_update INTEGER DEFAULT 0,
          retention_count INTEGER DEFAULT 5,
          retention_days INTEGER DEFAULT 30,
          custom_include_paths TEXT DEFAULT '[]',
          custom_exclude_paths TEXT DEFAULT '[]',
          FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE
        );
      `);
    },
  },
];

// ── Migration Runner ───────────────────────────────────────────────

/**
 * Ensure the schema_versions tracking table exists.
 */
function ensureVersionTable(db: SqlJsDatabase): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Get the set of already-applied migration versions.
 */
function getAppliedVersions(db: SqlJsDatabase): Set<number> {
  const result = db.exec("SELECT version FROM schema_versions");
  if (result.length === 0) return new Set();
  return new Set(result[0].values.map((row) => row[0] as number));
}

/**
 * Run all pending migrations in order.
 * Each migration runs inside a BEGIN/COMMIT transaction.
 * Returns the number of migrations applied.
 */
export function runMigrations(
  db: SqlJsDatabase,
  log: (msg: string) => void = console.log,
): number {
  ensureVersionTable(db);
  const applied = getAppliedVersions(db);

  const pending = migrations
    .filter((m) => !applied.has(m.version))
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    return 0;
  }

  let count = 0;
  for (const migration of pending) {
    try {
      db.run("BEGIN TRANSACTION");
      migration.up(db);
      db.run(
        "INSERT INTO schema_versions (version, name, applied_at) VALUES (?, ?, ?)",
        [migration.version, migration.name, new Date().toISOString()],
      );
      db.run("COMMIT");
      log(`[DB] Migration ${migration.version} (${migration.name}) applied`);
      count++;
    } catch (err) {
      db.run("ROLLBACK");
      log(
        `[DB] Migration ${migration.version} (${migration.name}) FAILED: ${err}`,
      );
      throw err;
    }
  }

  return count;
}

/**
 * Get current schema version (highest applied migration).
 */
export function getCurrentVersion(db: SqlJsDatabase): number {
  ensureVersionTable(db);
  const result = db.exec("SELECT MAX(version) FROM schema_versions");
  if (result.length === 0 || result[0].values[0][0] === null) return 0;
  return result[0].values[0][0] as number;
}
