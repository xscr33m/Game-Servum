import type { Database as SqlJsDatabase } from "sql.js";

export interface Migration {
  /** Monotonically increasing version number (must be unique) */
  version: number;
  /** Human-readable name for logging */
  name: string;
  /** Apply the migration. Runs inside BEGIN/COMMIT. */
  up: (db: SqlJsDatabase) => void;
}
