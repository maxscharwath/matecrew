/**
 * Writes the next migration from the changes in prisma/schema.prisma:
 *
 *   bun db:migration <name>
 *
 * Every existing migration is replayed into a scratch SQLite file, which
 * Prisma then diffs against the schema; the SQL lands in
 * migrations/<NNNN>_<name>.sql, for wrangler to apply
 * (`bun db:migrate:local`, then `wrangler d1 migrations apply matecrew --remote`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MIGRATIONS_DIR, applyMigrations, migrationFiles } from "./migrations";

const name = process.argv[2]?.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
if (!name) throw new Error("Usage: bun db:migration <name>");

const scratch = mkdtempSync(path.join(tmpdir(), "matecrew-diff-"));
try {
  const file = path.join(scratch, "replayed.sqlite");
  applyMigrations(file);
  const output = path.join(scratch, "diff.sql");
  const prisma = path.resolve(import.meta.dir, "../../node_modules/.bin/prisma");
  execFileSync(prisma, ["migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--script", "-o", output], {
    env: { ...process.env, PRISMA_DIFF_DATABASE_URL: `file:${file}` },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const sql = readFileSync(output, "utf8");
  if (!/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(sql)) {
    console.log("The schema matches the migrations: nothing to write.");
  } else {
    const next = String(migrationFiles().length + 1).padStart(4, "0");
    const target = path.join(MIGRATIONS_DIR, `${next}_${name}.sql`);
    writeFileSync(target, sql);
    console.log(`Wrote ${path.relative(process.cwd(), target)}. Review it, then: bun db:migrate:local`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
