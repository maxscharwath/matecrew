import path from "node:path";
import { loadEnvFile } from "node:process";
import { defineConfig } from "prisma/config";

// Prisma 7 doesn't auto-load env files — load .env.local (Next.js convention)
try {
  loadEnvFile(path.resolve(".env.local"));
} catch {
  // .env.local may not exist in CI/production
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DIRECT_URL!,
  },
});
