import { Database as SqliteFile } from "bun:sqlite";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { connectD1 } from "../../../src/platform/cloudflare/d1-database";
import { sqliteDatabaseAt } from "../../../src/platform/node/database";
import type { Database } from "../../../src/platform/ports/database";
import { migratedSqlite, SqliteD1 } from "./sqlite-d1";

const MIGRATIONS_DIR = path.resolve(import.meta.dir, "../../../migrations");

/** The Cloudflare adapter's batches (statements compiled, then `D1Database.batch()`) over an in-memory SQLite. */
export function d1Database(): Database {
  const connection = connectD1(new SqliteD1(migratedSqlite()).asBinding());
  return { client: () => connection.client, commitBatch: connection.commitBatch };
}

/** The Node adapter (libSQL, interactive transactions) over a fresh migrated SQLite file. */
export function nodeDatabase(): Database {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "matecrew-db-")), "test.sqlite");
  const sqlite = new SqliteFile(file);
  for (const name of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"));
  }
  sqlite.close();
  return sqliteDatabaseAt(`file:${file}`);
}

/** Both adapters, to run the same test against each. */
export const ADAPTERS: readonly { readonly name: string; readonly open: () => Database }[] = [
  { name: "cloudflare (D1 batch)", open: d1Database },
  { name: "node (libSQL transaction)", open: nodeDatabase },
];
