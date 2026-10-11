/**
 * Moves the production environment from Vercel to the Cloudflare worker, without showing a value.
 *
 *   bun scripts/cloudflare/vercel-env-to-worker.ts --dry-run   # names only: what moves, what is missing
 *   bun scripts/cloudflare/vercel-env-to-worker.ts             # uploads them as worker secrets
 *   bun scripts/cloudflare/vercel-env-to-worker.ts --from ~/matecrew-vercel-production.env
 *
 * Pulls Vercel's production variables (`vercel env pull`, project linked in .vercel/), keeps the
 * names the worker reads (.dev.vars.example, minus the platform bridge, which stays closed), and
 * uploads them with `wrangler secret bulk`: secrets survive deploys, unlike dashboard variables.
 * Variables marked Sensitive on Vercel come back empty: they are listed, never uploaded empty.
 * The Neon and Blob credentials the copy scripts need go to .env.migration.local (git-ignored,
 * readable by its owner only). Values are never printed; temporary files are deleted.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The worker's variables that this script does not move. */
const NOT_MOVED = new Set(["PLATFORM_BRIDGE_SECRET", "SCHEDULES_ENABLED", "NEXTJS_ENV"]);
/** Where the copy scripts read the source database from, best first. */
const SOURCE_DATABASE_KEYS = ["DIRECT_URL", "DATABASE_URL_UNPOOLED", "DATABASE_URL"];
const MIGRATION_FILE = ".env.migration.local";

type Env = Map<string, string>;

/** `KEY=value` lines as `vercel env pull` writes them, quotes and escaped newlines included. */
function parseEnv(text: string): Env {
  const env: Env = new Map();
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env.set(match[1], unquote(match[2]));
  }
  return env;
}

function unquote(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1).replaceAll(String.raw`\n`, "\n");
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  return raw;
}

function workerNames(): string[] {
  return [...parseEnv(readFileSync(".dev.vars.example", "utf8")).keys()].filter((name) => !NOT_MOVED.has(name));
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (exit ${result.status ?? "signal"})`);
}

/** `--from <file>`: an env file already on disk (e.g. opened from a sealed build), else a fresh pull. */
function sourceFile(): string | undefined {
  const at = process.argv.indexOf("--from");
  return at === -1 ? undefined : process.argv[at + 1];
}

function pullVercel(dir: string): Env {
  const given = sourceFile();
  if (given) return parseEnv(readFileSync(given, "utf8"));
  const file = join(dir, "vercel.env");
  run("vercel", ["env", "pull", file, "--environment=production", "--yes"]);
  return parseEnv(readFileSync(file, "utf8"));
}

function writePrivate(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function migrationEnv(vercel: Env): string[] {
  const source = SOURCE_DATABASE_KEYS.map((key) => vercel.get(key)).find(Boolean);
  const blob = vercel.get("BLOB_READ_WRITE_TOKEN");
  const lines: string[] = [];
  if (source) lines.push(`SOURCE_DATABASE_URL=${JSON.stringify(source)}`);
  if (blob) lines.push(`BLOB_READ_WRITE_TOKEN=${JSON.stringify(blob)}`);
  return lines;
}

function report(title: string, names: string[]): void {
  console.log(`${title} (${names.length}): ${names.length ? names.join(", ") : "none"}`);
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const dir = mkdtempSync(join(tmpdir(), "matecrew-env-"));
  try {
    const vercel = pullVercel(dir);
    const wanted = workerNames();
    const moved = wanted.filter((name) => vercel.get(name));
    report("Worker secrets", moved);
    report("Missing on Vercel (set them on the worker by hand)", wanted.filter((name) => !vercel.has(name)));
    // Vercel never gives back a "Sensitive" variable: `env pull` writes it empty.
    report(
      "Empty on Vercel, likely Sensitive (set them with `wrangler secret put`)",
      wanted.filter((name) => vercel.get(name) === ""),
    );
    const migration = migrationEnv(vercel);
    report(`Copy-script credentials for ${MIGRATION_FILE}`, migration.map((line) => line.split("=")[0]));
    if (dryRun) return;

    const secrets = join(dir, "secrets.json");
    writePrivate(secrets, JSON.stringify(Object.fromEntries(moved.map((name) => [name, vercel.get(name)]))));
    run("bunx", ["wrangler", "secret", "bulk", secrets]);
    if (migration.length) writePrivate(MIGRATION_FILE, `${migration.join("\n")}\n`);
    console.log(`Done. NEXT_PUBLIC_APP_URL is also read at build time: deploy with it set in the environment.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
