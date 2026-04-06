import type { Migration } from "./types.js";

export const migration: Migration = {
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
        restart_time TEXT DEFAULT NULL,
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
};
