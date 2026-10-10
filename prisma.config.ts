import { defineConfig } from "prisma/config";

// Prisma generates the client and diffs the schema; the app reaches the
// database through src/platform. Migrations are plain SQL files in
// migrations/, applied by wrangler (`bun db:migrate:local`) or to the Node
// platform's SQLite file (`bun db:migrate:sqlite`). The datasource below is
// only the scratch SQLite file a schema diff starts from: `bun db:migration
// <name>` (scripts/db/new-migration.ts) points it at a replay of migrations/.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "bun ./prisma/seed.ts",
  },
  datasource: {
    url: process.env.PRISMA_DIFF_DATABASE_URL ?? "file:./.wrangler/prisma-diff.sqlite",
  },
});
