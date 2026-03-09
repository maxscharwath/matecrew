import path from "node:path";
import { loadEnvFile } from "node:process";
import { defineConfig } from "prisma/config";

// Prisma 7 doesn't auto-load env files — load .env.local (Next.js convention)
try {
  loadEnvFile(path.resolve(".env.local"));
} catch {
  // .env.local may not exist in CI/production
}

/** Ensure connect_timeout is set (Neon cold starts can exceed the default). */
function appendConnectTimeout(url: string, seconds = 30): string {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return url.includes("connect_timeout") ? url : `${url}${sep}connect_timeout=${seconds}`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "bun ./prisma/seed.ts",
  },
  datasource: {
    url: appendConnectTimeout(
      process.env.DIRECT_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
    ),
  },
});
