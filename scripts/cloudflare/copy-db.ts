/**
 * Full copy of the Postgres (Neon) database into D1.
 *
 *   SOURCE_DATABASE_URL=postgres://… bun scripts/cloudflare/copy-db.ts export [--out .data/d1-copy]
 *   bun scripts/cloudflare/copy-db.ts apply --local|--remote [--out .data/d1-copy]
 *   SOURCE_DATABASE_URL=postgres://… bun scripts/cloudflare/copy-db.ts verify --local|--remote
 *
 * export   reads every table (read only) and writes numbered SQL files for
 *          `wrangler d1 execute`: they clear the D1 tables, then insert every
 *          row in foreign-key order, so applying them again gives the same data.
 *          Roles become MembershipRole rows, Decimal amounts integer cents
 *          (refused if one is not exact, unless --allow-rounding), days and
 *          timestamps UTC text, Device.syncTimes a comma-separated list, bytes
 *          blobs; statements stay under D1's 100 KB limit.
 * apply    runs the files with `wrangler d1 execute matecrew`, in order. The
 *          D1 schema must exist first (`wrangler d1 migrations apply matecrew`).
 * verify   compares, table by table, the row count, the set of primary keys,
 *          and sums (cents, quantities, blob bytes) between Postgres and D1.
 *
 * --remote writes to or reads the production D1 database: run it yourself.
 * --persist-to <dir> (with --local) uses a local D1 kept in <dir> instead of
 * .wrangler/state, to rehearse the copy without touching your local data.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { baselineSchema, type TargetTable } from "./copy-db/schema";
import {
  DERIVED_TABLES,
  clearStatements,
  insertStatements,
  membershipRoleRows,
  packFiles,
  rowLiterals,
  type SourceRow,
  type TransformReport,
} from "./copy-db/transform";

const DATABASE = "matecrew";
const DEFAULT_OUT = ".data/d1-copy";
const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** Foreign keys are checked at the end of each file's transaction, as D1 recommends for imports. */
const PRELUDE = "PRAGMA defer_foreign_keys = true;";

/** Postgres OIDs of date, timestamp and timestamptz: kept as the server's text, converted without a local time zone. */
const SOURCE_TYPE_PARSERS = [1082, 1114, 1184];

type Target = "local" | "remote";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

/** Wrangler's target flags; a local run can keep its state elsewhere than .wrangler/state (--persist-to). */
function targetArgs(where: Target): string[] {
  const persistTo = option("persist-to", "");
  if (where === "local" && persistTo) return ["--local", "--persist-to", persistTo];
  return [`--${where}`];
}

function target(): Target {
  if (flag("local") === flag("remote")) throw new Error("Pass exactly one of --local or --remote.");
  return flag("remote") ? "remote" : "local";
}

async function connectSource(): Promise<pg.Client> {
  const connectionString = process.env.SOURCE_DATABASE_URL;
  if (!connectionString) throw new Error("Set SOURCE_DATABASE_URL to the Postgres database to copy from.");
  for (const oid of SOURCE_TYPE_PARSERS) pg.types.setTypeParser(oid, (text: string) => text);
  const client = new pg.Client({ connectionString });
  await client.connect();
  // Nothing in this script writes to the source.
  await client.query("SET default_transaction_read_only = on");
  return client;
}

async function readTable(client: pg.Client, table: TargetTable): Promise<SourceRow[]> {
  if (DERIVED_TABLES[table.name] === "Membership") {
    // As text[], which node-postgres parses, unlike an array of an enum type.
    const { rows } = await client.query<SourceRow>(`SELECT "id", "roles"::text[] AS "roles" FROM "Membership" ORDER BY "id"`);
    return rows.flatMap(membershipRoleRows);
  }
  const order = table.primaryKey.map((key) => `"${key}"`).join(", ");
  const { rows } = await client.query<SourceRow>(`SELECT * FROM "${table.name}" ORDER BY ${order}`);
  return rows;
}

async function exportCopy(): Promise<void> {
  const out = option("out", DEFAULT_OUT);
  const tables = baselineSchema();
  const client = await connectSource();
  const report: TransformReport = { inexact: [] };
  try {
    const perTable = await tables.reduce<Promise<{ statements: string[]; counts: string[] }>>(async (previous, table) => {
      const acc = await previous;
      const rows = await readTable(client, table);
      const literals = rows.map((row) => rowLiterals(table, row, report));
      acc.statements.push(...insertStatements(table, literals));
      acc.counts.push(`${table.name}: ${rows.length}`);
      return acc;
    }, Promise.resolve({ statements: [], counts: [] }));

    if (report.inexact.length > 0 && !flag("allow-rounding")) {
      throw new Error(`Amounts that are not whole cents:\n${report.inexact.join("\n")}\nRerun with --allow-rounding to round them half away from zero.`);
    }

    const files = packFiles([...clearStatements(tables), ...perTable.statements], PRELUDE, MAX_FILE_BYTES);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    files.forEach((sql, index) => writeFileSync(path.join(out, `${String(index + 1).padStart(4, "0")}.sql`), sql));
    console.log(perTable.counts.join("\n"));
    console.log(`\n${files.length} file(s) in ${out}. Next: bun scripts/cloudflare/copy-db.ts apply --local|--remote`);
  } finally {
    await client.end();
  }
}

/** The project's own wrangler, by absolute path. */
const WRANGLER = path.resolve(import.meta.dirname, "../../node_modules/.bin/wrangler");

function wrangler(args: readonly string[]): string {
  return execFileSync(WRANGLER, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function applyCopy(): void {
  const where = target();
  const out = option("out", DEFAULT_OUT);
  const files = readdirSync(out).filter((name) => name.endsWith(".sql")).sort((a, b) => a.localeCompare(b));
  if (files.length === 0) throw new Error(`No SQL files in ${out}: run export first.`);
  for (const file of files) {
    console.log(`Applying ${file} (${where})…`);
    wrangler(["d1", "execute", DATABASE, ...targetArgs(where), "--yes", "--file", path.join(out, file)]);
  }
  console.log("Applied. Next: bun scripts/cloudflare/copy-db.ts verify --" + where);
}

/** One check: the same figure computed on both sides. */
interface Check {
  readonly label: string;
  readonly source: string;
  readonly target: string;
  /** Compared as a fingerprint of the sorted list rather than as a number. */
  readonly keys?: true;
}

const SUMS: readonly Check[] = [
  { label: "PurchaseBatch cents", source: `SELECT COALESCE(SUM(ROUND("totalPrice" * 100)), 0) AS v FROM "PurchaseBatch"`, target: `SELECT COALESCE(SUM("totalPriceCents"), 0) AS v FROM "PurchaseBatch"` },
  { label: "PurchaseLine unit cents", source: `SELECT COALESCE(SUM(ROUND("unitPrice" * 100)), 0) AS v FROM "PurchaseLine"`, target: `SELECT COALESCE(SUM("unitPriceCents"), 0) AS v FROM "PurchaseLine"` },
  { label: "PurchaseLine total cents", source: `SELECT COALESCE(SUM(ROUND("lineTotal" * 100)), 0) AS v FROM "PurchaseLine"`, target: `SELECT COALESCE(SUM("lineTotalCents"), 0) AS v FROM "PurchaseLine"` },
  { label: "ReimbursementLine cents", source: `SELECT COALESCE(SUM(ROUND("amount" * 100)), 0) AS v FROM "ReimbursementLine"`, target: `SELECT COALESCE(SUM("amountCents"), 0) AS v FROM "ReimbursementLine"` },
  { label: "Stock cans", source: `SELECT COALESCE(SUM("currentQty"), 0) AS v FROM "Stock"`, target: `SELECT COALESCE(SUM("currentQty"), 0) AS v FROM "Stock"` },
  { label: "StockMovement deltas", source: `SELECT COALESCE(SUM("delta"), 0) AS v FROM "StockMovement"`, target: `SELECT COALESCE(SUM("delta"), 0) AS v FROM "StockMovement"` },
  { label: "ConsumptionEntry cans", source: `SELECT COALESCE(SUM("qty"), 0) AS v FROM "ConsumptionEntry"`, target: `SELECT COALESCE(SUM("qty"), 0) AS v FROM "ConsumptionEntry"` },
  { label: "Item picture bytes", source: `SELECT COALESCE(SUM(OCTET_LENGTH("terminalImage")), 0) AS v FROM "Item"`, target: `SELECT COALESCE(SUM(LENGTH("terminalImage")), 0) AS v FROM "Item"` },
  { label: "DeviceFrame bytes", source: `SELECT COALESCE(SUM(OCTET_LENGTH("bits")), 0) AS v FROM "DeviceFrame"`, target: `SELECT COALESCE(SUM(LENGTH("bits")), 0) AS v FROM "DeviceFrame"` },
  { label: "Days on or after 2026", source: `SELECT COUNT(*) AS v FROM "ConsumptionEntry" WHERE "date" >= DATE '2026-01-01'`, target: `SELECT COUNT(*) AS v FROM "ConsumptionEntry" WHERE "date" >= '2026-01-01T00:00:00.000+00:00'` },
];

/** Row count and primary keys of every table, on both sides. */
function tableChecks(tables: readonly TargetTable[]): Check[] {
  return tables.flatMap((table): Check[] => {
    const key = table.primaryKey.map((column) => `"${column}"`).join(` || '|' || `);
    if (table.name === "MembershipRole") {
      return [
        { label: "MembershipRole rows", source: `SELECT COALESCE(SUM(CARDINALITY("roles")), 0) AS v FROM "Membership"`, target: `SELECT COUNT(*) AS v FROM "MembershipRole"` },
        { label: "MembershipRole keys", source: `SELECT "id" || '|' || r::text AS v FROM "Membership", UNNEST("roles") AS r`, target: `SELECT ${key} AS v FROM "MembershipRole"`, keys: true },
      ];
    }
    return [
      { label: `${table.name} rows`, source: `SELECT COUNT(*) AS v FROM "${table.name}"`, target: `SELECT COUNT(*) AS v FROM "${table.name}"` },
      { label: `${table.name} keys`, source: `SELECT ${key} AS v FROM "${table.name}"`, target: `SELECT ${key} AS v FROM "${table.name}"`, keys: true },
    ];
  });
}

/** A figure, or the fingerprint of a list of keys (sorted here, so collations do not matter). */
function figure(values: readonly unknown[], keys: boolean): string {
  if (!keys) return String(Number(values[0] ?? 0));
  const sorted = values.map(String).sort((a, b) => (a < b ? -1 : Number(a > b)));
  return `${sorted.length} keys, sha256 ${createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, 16)}`;
}

function queryTarget(where: Target, checks: readonly Check[]): unknown[][] {
  const sql = checks.map((check) => `${check.target};`).join("\n");
  const file = path.join(DEFAULT_OUT, "verify.sql");
  mkdirSync(DEFAULT_OUT, { recursive: true });
  writeFileSync(file, sql);
  const output = wrangler(["d1", "execute", DATABASE, ...targetArgs(where), "--json", "--file", file]);
  // Wrangler may print notices first; the JSON array starts on a line of its own.
  const results = JSON.parse(output.slice(output.search(/^\[/m))) as { results: { v: unknown }[] }[];
  return results.map((result) => result.results.map((row) => row.v));
}

async function verifyCopy(): Promise<void> {
  const where = target();
  const checks = [...tableChecks(baselineSchema()), ...SUMS];
  const client = await connectSource();
  try {
    const sourceValues = await checks.reduce<Promise<unknown[][]>>(async (previous, check) => {
      const acc = await previous;
      const { rows } = await client.query<{ v: unknown }>(check.source);
      acc.push(rows.map((row) => row.v));
      return acc;
    }, Promise.resolve([]));
    const targetValues = queryTarget(where, checks);

    const compared = checks.map((check, i) => ({
      label: check.label,
      expected: figure(sourceValues[i], check.keys === true),
      actual: figure(targetValues[i] ?? [], check.keys === true),
    }));
    for (const { label, expected, actual } of compared) {
      if (expected === actual) console.log(`ok       ${label}: ${expected}`);
      else console.log(`MISMATCH ${label}: ${expected} in Postgres, ${actual} in D1`);
    }
    const mismatches = compared.filter((c) => c.expected !== c.actual);
    if (mismatches.length > 0) {
      process.exitCode = 1;
      console.error(`\n${mismatches.length} check(s) differ.`);
    } else {
      console.log(`\nAll ${checks.length} checks match.`);
    }
  } finally {
    await client.end();
  }
}

const COMMANDS: Readonly<Record<string, () => Promise<void> | void>> = {
  export: exportCopy,
  apply: applyCopy,
  verify: verifyCopy,
};

const command = COMMANDS[process.argv[2] ?? ""];
if (!command) {
  console.error(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(2);
}
await command();
