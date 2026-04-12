import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 2,
  name: "add_version",
  up: (db) => {
    db.run(`ALTER TABLE game_servers ADD COLUMN version TEXT DEFAULT NULL`);
  },
};
