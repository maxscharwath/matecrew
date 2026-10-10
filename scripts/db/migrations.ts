import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** The SQL migrations wrangler applies to D1 (wrangler.jsonc `migrations_dir`). */
export const MIGRATIONS_DIR = path.resolve(import.meta.dir, "../../migrations");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Applies the migrations a SQLite file has not had yet, each in a
 * transaction, and records them in `d1_migrations` as wrangler does on D1, so
 * the same files serve both. Returns the names applied.
 */
export function applyMigrations(file: string): string[] {
  const db = new Database(file, { create: true });
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(
      "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    );
    const applied = new Set(db.query<{ name: string }, []>("SELECT name FROM d1_migrations").all().map((row) => row.name));
    const pending = migrationFiles().filter((name) => !applied.has(name));
    for (const name of pending) {
      db.transaction(() => {
        db.exec(readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"));
        db.query("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
      })();
    }
    return pending;
  } finally {
    db.close();
  }
}
