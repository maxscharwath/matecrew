import { test } from "node:test";
import assert from "node:assert/strict";
import { baselineSchema } from "../../scripts/cloudflare/copy-db/schema";
import {
  clearStatements,
  decimalToCents,
  insertStatements,
  membershipRoleRows,
  packFiles,
  rowLiterals,
  toD1DateTime,
  type SourceRow,
  type TransformReport,
} from "../../scripts/cloudflare/copy-db/transform";
import { connectD1 } from "../../src/platform/cloudflare/d1-database";
import { roleList, rolesSelect } from "../../src/lib/membership-roles";
import { parseSyncTimes } from "../../src/lib/device/sync-times";
import { migratedSqlite, SqliteD1 } from "./support/sqlite-d1";

const tables = baselineSchema();
const table = (name: string) => {
  const found = tables.find((t) => t.name === name);
  if (!found) throw new Error(`No table ${name}`);
  return found;
};

test("decimal amounts become exact cents", () => {
  assert.deepEqual(decimalToCents("12.50"), { cents: 1250, exact: true });
  assert.deepEqual(decimalToCents("1.45"), { cents: 145, exact: true });
  assert.deepEqual(decimalToCents("120"), { cents: 12000, exact: true });
  assert.deepEqual(decimalToCents("0.05"), { cents: 5, exact: true });
  assert.deepEqual(decimalToCents("99999999.99"), { cents: 9_999_999_999, exact: true });
  assert.deepEqual(decimalToCents("-3.10"), { cents: -310, exact: true });
  assert.deepEqual(decimalToCents("-0.00"), { cents: 0, exact: true });
  assert.ok(Object.is(decimalToCents("-0.00").cents, 0));
  assert.deepEqual(decimalToCents("2.3300"), { cents: 233, exact: true });
});

test("a fraction of a cent is rounded half away from zero and flagged", () => {
  assert.deepEqual(decimalToCents("1.005"), { cents: 101, exact: false });
  assert.deepEqual(decimalToCents("1.004"), { cents: 100, exact: false });
  assert.deepEqual(decimalToCents("-1.005"), { cents: -101, exact: false });
  assert.throws(() => decimalToCents("1e3"), RangeError);
});

test("days and timestamps are written as Prisma's D1 adapter writes them", () => {
  assert.equal(toD1DateTime("2026-03-02"), "2026-03-02T00:00:00.000+00:00");
  assert.equal(toD1DateTime("2026-03-02 09:01:02.345"), "2026-03-02T09:01:02.345+00:00");
  assert.equal(toD1DateTime("2026-03-02 09:01:02"), "2026-03-02T09:01:02.000+00:00");
  assert.equal(toD1DateTime("2026-03-02 10:01:02.5+01"), "2026-03-02T09:01:02.500+00:00");
  assert.throws(() => toD1DateTime("infinity"), RangeError);
});

test("roles become one MembershipRole row each", () => {
  assert.deepEqual(membershipRoleRows({ id: "m1", roles: ["ADMIN", "USER", "ADMIN"] }), [
    { membershipId: "m1", role: "ADMIN" },
    { membershipId: "m1", role: "USER" },
  ]);
  assert.throws(() => membershipRoleRows({ id: "m2", roles: [] }), /no roles/);
});

test("the target schema is ordered parents first", () => {
  const position = new Map(tables.map((t, i) => [t.name, i]));
  for (const t of tables) {
    for (const parent of t.references) assert.ok(position.get(parent)! < position.get(t.name)!, `${parent} before ${t.name}`);
  }
  assert.equal(clearStatements(tables)[0], `DELETE FROM "${tables.at(-1)!.name}";`);
});

/** Applies generated statements to a migrated in-memory database with foreign keys on, as D1 has them. */
function applyCopy(statements: readonly string[]) {
  const sqlite = migratedSqlite();
  for (const statement of statements) sqlite.exec(statement);
  return connectD1(new SqliteD1(sqlite).asBinding()).client;
}

const frame = Uint8Array.from({ length: 48_000 }, (_, i) => (i * 7919) % 256);

const SOURCE: Readonly<Record<string, readonly SourceRow[]>> = {
  Office: [{ id: "o1", name: "L'atelier", timezone: "Europe/Zurich", locale: "fr", slackChannelId: null, slackChannelLabel: "a\nb; --", lowStockThreshold: 5, createdAt: "2026-03-01 08:00:00", updatedAt: "2026-03-01 08:00:00.5" }],
  User: [{ id: "u1", name: "Zoé", email: "zoe@example.com", emailVerified: true, image: null, locale: "fr", slackUserId: null, defaultOfficeId: "o1", createdAt: "2026-03-01 08:00:00", updatedAt: "2026-03-01 08:00:00" }],
  Item: [{ id: "i1", officeId: "o1", name: "Maté", imageKey: null, terminalImage: Uint8Array.from([0, 255, 1]), active: true, isDefault: false, sortOrder: 0, color: null, lowStockThreshold: null, volumeMl: 500, sugarGrams: 0.1, caffeineMg: 33.333333333333336, createdAt: "2026-03-01 08:00:00", updatedAt: "2026-03-01 08:00:00" }],
  Membership: [{ id: "m1", userId: "u1", officeId: "o1", roles: "{ADMIN,USER}", createdAt: "2026-03-01 08:00:00" }],
  PurchaseBatch: [{ id: "p1", officeId: "o1", status: "DELIVERED", purchasedAt: "2026-03-01 08:00:00", deliveredAt: null, orderedByUserId: "u1", paidByUserId: "u1", totalPrice: "34.80", notes: null, createdAt: "2026-03-01 08:00:00" }],
  PurchaseLine: [{ id: "l1", batchId: "p1", itemId: "i1", qty: 24, unitPrice: "1.45", lineTotal: "34.80" }],
  Device: [{ id: "d1", officeId: "o1", name: "Frigo", hardwareId: "AA", tokenHash: "h", linkedById: null, leftAction: "TAKE", leftItemId: "i1", leftLabel: null, rightAction: "RETURN", rightItemId: null, rightLabel: null, syncTimes: ["07:30", "12:00"], firmwareVersion: null, batteryMv: null, wifiRssi: null, lastSeenAt: null, polledAt: null, watchedAt: null, createdAt: "2026-03-01 08:00:00", updatedAt: "2026-03-01 08:00:00" }],
  DeviceFrame: [{ deviceId: "d1", bits: frame, hash: "f", drawnAt: "2026-03-02 09:01:02.345" }],
  ConsumptionEntry: [{ id: "c1", officeId: "o1", userId: "u1", itemId: "i1", date: "2026-03-02", qty: 2, source: "MANUAL", purchaseBatchId: null, deviceId: "d1", cancelledAt: null, createdAt: "2026-03-02 09:00:00" }],
};

function statementsFor(maxStatementBytes: number): { statements: string[]; report: TransformReport } {
  const report: TransformReport = { inexact: [] };
  const statements = tables.flatMap((t) => {
    const rows = t.name === "MembershipRole" ? [{ membershipId: "m1", role: "ADMIN" }, { membershipId: "m1", role: "USER" }] : (SOURCE[t.name] ?? []);
    return insertStatements(t, rows.map((row) => rowLiterals(t, row, report)), { maxStatementBytes });
  });
  return { statements: [...clearStatements(tables), ...statements], report };
}

test("a copy reads back through Prisma exactly as the source had it", async () => {
  const { statements, report } = statementsFor(90_000);
  assert.deepEqual(report.inexact, []);
  assert.ok(statements.every((s) => Buffer.byteLength(s) <= 90_000), "every statement under the limit");
  const db = applyCopy(statements);

  const office = await db.office.findUniqueOrThrow({ where: { id: "o1" } });
  assert.equal(office.name, "L'atelier");
  assert.equal(office.slackChannelLabel, "a\nb; --");
  assert.equal(office.updatedAt.toISOString(), "2026-03-01T08:00:00.500Z");

  const item = await db.item.findUniqueOrThrow({ where: { id: "i1" } });
  assert.deepEqual([...item.terminalImage!], [0, 255, 1]);
  assert.equal(item.terminalPhoto, null);
  assert.equal(item.caffeineMg, 33.333333333333336);
  assert.equal(item.active, true);

  const membership = await db.membership.findUniqueOrThrow({ where: { id: "m1" }, include: rolesSelect });
  assert.deepEqual(roleList(membership), ["ADMIN", "USER"]);

  const line = await db.purchaseLine.findUniqueOrThrow({ where: { id: "l1" } });
  assert.deepEqual([line.unitPriceCents, line.lineTotalCents], [145, 3480]);

  const device = await db.device.findUniqueOrThrow({ where: { id: "d1" } });
  assert.deepEqual(parseSyncTimes(device.syncTimes), ["07:30", "12:00"]);

  const entry = await db.consumptionEntry.findFirstOrThrow({ where: { date: new Date("2026-03-02T00:00:00Z") } });
  assert.equal(entry.id, "c1");

  const copied = await db.deviceFrame.findUniqueOrThrow({ where: { deviceId: "d1" } });
  assert.deepEqual(copied.bits, frame);
});

test("a row longer than a statement is split and its blob rebuilt byte for byte", async () => {
  const { statements } = statementsFor(20_000);
  assert.ok(statements.some((s) => s.startsWith(`UPDATE "DeviceFrame"`)), "the frame was appended in chunks");
  assert.ok(statements.every((s) => Buffer.byteLength(s) <= 20_000));
  const db = applyCopy(statements);
  const copied = await db.deviceFrame.findUniqueOrThrow({ where: { deviceId: "d1" } });
  assert.deepEqual(copied.bits, frame);
});

test("applying the copy twice gives the same data", async () => {
  const { statements } = statementsFor(90_000);
  const db = applyCopy([...statements, ...statements]);
  assert.equal(await db.membershipRole.count(), 2);
  assert.equal(await db.purchaseLine.count(), 1);
});

test("files are split under the size given, each with the prelude", () => {
  const files = packFiles(["a;", "b;", "c;"], "PRAGMA x;", 6);
  assert.deepEqual(files, ["PRAGMA x;\na;\nb;\n", "PRAGMA x;\nc;\n"]);
});

test("a NULL in a NOT NULL column is refused", () => {
  assert.throws(() => rowLiterals(table("Office"), { ...SOURCE.Office[0], name: null }, { inexact: [] }), /NOT NULL/);
});
