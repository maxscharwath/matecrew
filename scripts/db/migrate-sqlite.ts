/**
 * Applies migrations/*.sql to the Node platform's SQLite database
 * (DATABASE_URL, a `file:` URL, or .data/matecrew.sqlite): what `bun run dev`
 * and `bun run start` use. D1 gets the same files from
 * `wrangler d1 migrations apply matecrew --local|--remote`.
 *
 *   bun db:migrate:sqlite
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { applyMigrations } from "./migrations";

const url = process.env.DATABASE_URL ?? "file:.data/matecrew.sqlite";
if (!url.startsWith("file:")) throw new Error(`Only file: databases are migrated here, not ${url.split(":")[0]}: URLs.`);
const file = url.slice("file:".length);
mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

const applied = applyMigrations(file);
console.log(applied.length > 0 ? `Applied ${applied.join(", ")} to ${file}.` : `${file} is up to date.`);
