/**
 * Loads a data-only dump of the D1 database (`wrangler d1 export --no-schema`)
 * into a fresh SQLite file for the Node platform:
 *
 *   bun scripts/db/import-sqlite.ts <dump.sql> <file.sqlite>
 *
 * The file is recreated with migrations/ applied, then filled. Foreign keys
 * are checked once everything is in, since a dump lists tables in creation
 * order, not in dependency order. Wrangler's migration log and Cloudflare's
 * internal tables are skipped: the file has its own log.
 */
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { applyMigrations } from "./migrations";

const [dump, file] = process.argv.slice(2);
if (!dump || !file) throw new Error("Usage: bun scripts/db/import-sqlite.ts <dump.sql> <file.sqlite>");

if (existsSync(file)) rmSync(file);
applyMigrations(file);

const statements = readFileSync(dump, "utf8")
  .split("\n")
  .filter((line) => !/^INSERT INTO "?(d1_migrations|_cf_\w+)"?/.test(line) && !/^PRAGMA /.test(line))
  .join("\n");

const db = new Database(file);
try {
  db.exec("PRAGMA foreign_keys = OFF");
  db.transaction(() => db.exec(statements))();
  db.exec("PRAGMA foreign_keys = ON");
  const broken = db.query<{ table: string }, []>("PRAGMA foreign_key_check").all();
  if (broken.length > 0) {
    throw new Error(`Rows pointing at missing rows in: ${[...new Set(broken.map((row) => row.table))].join(", ")}`);
  }
} finally {
  db.close();
}
console.log(`Loaded ${dump} into ${file}.`);
