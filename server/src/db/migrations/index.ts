/**
 * Migration Registry
 *
 * All migrations must be statically imported here so esbuild can bundle them.
 *
 * To add a new migration:
 * 1. Create `NNN_description.ts` in this directory (export `migration`)
 * 2. Import it below and add it to the `migrations` array
 */

import type { Database as SqlJsDatabase } from "sql.js";
import type { Migration } from "./types.js";

import { migration as m001 } from "./001_initial_schema.js";
import { migration as m002 } from "./002_add_version.js";

// All migrations in order. The runner sorts by version, but keeping this
// array in order makes it easy to see the migration history at a glance.
const migrations: Migration[] = [m001, m002];

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
