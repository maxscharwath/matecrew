/**
 * Demo data for a local database: the local D1 (`bun db:migrate:local` first)
 * that `bun run dev:cf` and `bun run preview` use, or with `--sqlite` the Node
 * platform's SQLite file (DATABASE_URL, `bun db:migrate:sqlite` first) that
 * `bun run dev` uses:
 * two offices, their items and weekly sessions, a few members, five days of
 * requests and one delivered order. Safe to run twice: what exists is kept.
 *
 * Every demo account gets the password in SEED_PASSWORD: credentials are
 * never written in the source.
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { Role } from "../src/generated/prisma/client";
import { createMembershipWrites } from "../src/lib/membership-roles";
import { toCents } from "../src/lib/money";
import { utcDate } from "../src/lib/date";
import { sqliteDatabaseAt } from "../src/platform/node/database";
import type { Database, Db } from "../src/platform/ports/database";
import { withLocalD1 } from "../scripts/cloudflare/local-d1";

/** Runs `step` on each item, one after the other. */
function inSequence<T>(items: readonly T[], step: (item: T) => Promise<unknown>): Promise<void> {
  return items.reduce<Promise<void>>(async (previous, item) => {
    await previous;
    await step(item);
  }, Promise.resolve());
}

const OFFICES = [
  { name: "Lausanne", timezone: "Europe/Zurich", lowStockThreshold: 30 },
  { name: "Genève", timezone: "Europe/Zurich", lowStockThreshold: 30 },
] as const;

const ITEMS = [
  { name: "Maté Classic", isDefault: true, sortOrder: 0 },
  { name: "Maté Zero", isDefault: false, sortOrder: 1 },
  { name: "Ginger", isDefault: false, sortOrder: 2 },
] as const;

const PEOPLE: readonly {
  readonly name: string;
  readonly email: string;
  readonly offices: readonly (typeof OFFICES)[number]["name"][];
  readonly roles: readonly Role[];
}[] = [
  { name: "Admin", email: "admin@matecrew.local", offices: ["Lausanne", "Genève"], roles: ["ADMIN", "USER"] },
  { name: "Marie Runner", email: "marie@matecrew.local", offices: ["Lausanne"], roles: ["USER"] },
  { name: "Alice Dupont", email: "alice@matecrew.local", offices: ["Lausanne"], roles: ["USER"] },
  { name: "Bob Martin", email: "bob@matecrew.local", offices: ["Lausanne"], roles: ["USER"] },
  { name: "Claire Favre", email: "claire@matecrew.local", offices: ["Genève"], roles: ["USER"] },
];

/** Monday to Friday, a morning and an afternoon round. */
const SESSIONS = [1, 2, 3, 4, 5].flatMap((dayOfWeek) => [
  { dayOfWeek, startTime: "08:00", cutoffTime: "10:00", label: "Matin" },
  { dayOfWeek, startTime: "14:00", cutoffTime: "16:00", label: "Après-midi" },
]);

const DELIVERED_CANS = 48;
const CAN_PRICE = 2.5;

async function seedOffices(db: Db): Promise<Map<string, { officeId: string; defaultItemId: string }>> {
  const offices = new Map<string, { officeId: string; defaultItemId: string }>();
  await inSequence(OFFICES, async (data) => {
    const office = await db.office.upsert({ where: { name: data.name }, update: {}, create: data });
    const items = await Promise.all(
      ITEMS.map((item) =>
        db.item.upsert({
          where: { officeId_name: { officeId: office.id, name: item.name } },
          update: {},
          create: { officeId: office.id, ...item },
        }),
      ),
    );
    const defaultItemId = items[0].id;
    await db.stock.upsert({
      where: { officeId_itemId: { officeId: office.id, itemId: defaultItemId } },
      update: {},
      create: { officeId: office.id, itemId: defaultItemId, currentQty: 24 },
    });
    offices.set(office.name, { officeId: office.id, defaultItemId });
    console.log(`  ${office.name}: ${ITEMS.map((i) => i.name).join(", ")}; 24 cans of ${ITEMS[0].name}`);
  });
  return offices;
}

async function seedPeople(
  db: Database,
  officeIds: ReadonlyMap<string, { officeId: string }>,
  password: string,
): Promise<Map<string, string>> {
  const auth = betterAuth({
    database: prismaAdapter(db.client(), { provider: "sqlite", transaction: false }),
    emailAndPassword: { enabled: true },
  });
  const userIds = new Map<string, string>();
  await inSequence(PEOPLE, async (person) => {
    if (!(await db.client().user.findUnique({ where: { email: person.email } }))) {
      await auth.api.signUpEmail({ body: { name: person.name, email: person.email, password } });
      console.log(`  Created ${person.email}`);
    }
    const user = await db.client().user.findUniqueOrThrow({ where: { email: person.email } });
    userIds.set(person.email, user.id);
    const existing = await db.client().membership.findMany({ where: { userId: user.id }, select: { officeId: true } });
    const missing = person.offices
      .map((name) => officeIds.get(name)?.officeId)
      .filter((officeId): officeId is string => !!officeId && !existing.some((m) => m.officeId === officeId));
    await db.commitBatch((batch) =>
      missing.flatMap((officeId) =>
        createMembershipWrites(batch, { id: crypto.randomUUID(), userId: user.id, officeId, roles: person.roles }),
      ),
    );
  });
  return userIds;
}

async function seedSessions(db: Db, officeId: string) {
  return Promise.all(
    SESSIONS.map((s) =>
      db.mateSession.upsert({
        where: { officeId_dayOfWeek_startTime: { officeId, dayOfWeek: s.dayOfWeek, startTime: s.startTime } },
        update: {},
        create: { officeId, ...s },
      }),
    ),
  );
}

/**
 * Requests over the last five days in Lausanne, served except today's, with
 * their consumption and stock movements, written once.
 */
async function seedRequests(
  db: Database,
  office: { officeId: string; defaultItemId: string },
  userIds: readonly string[],
  sessions: readonly { id: string; dayOfWeek: number; startTime: string }[],
) {
  if ((await db.client().dailyRequest.count({ where: { officeId: office.officeId } })) > 0) {
    console.log("  Requests already exist, skipping");
    return;
  }
  const now = new Date();
  const requests = [4, 3, 2, 1, 0].flatMap((daysAgo) => {
    const date = utcDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo);
    const session = sessions.find((s) => s.dayOfWeek === date.getUTCDay() && s.startTime === "08:00");
    return userIds
      .filter((_, i) => (daysAgo + i) % 3 !== 0)
      .map((userId) => ({
        officeId: office.officeId,
        userId,
        itemId: office.defaultItemId,
        date,
        mateSessionId: session?.id ?? null,
        status: daysAgo > 0 ? ("SERVED" as const) : ("REQUESTED" as const),
      }));
  });
  const served = requests.filter((r) => r.status === "SERVED");
  await db.commitBatch((batch) => [
    batch.dailyRequest.createMany({ data: requests }),
    batch.consumptionEntry.createMany({
      data: served.map((r) => ({ officeId: r.officeId, userId: r.userId, itemId: r.itemId, date: r.date, qty: 1, source: "DAILY_REQUEST" as const })),
    }),
    batch.stockMovement.createMany({
      data: served.map((r) => ({ officeId: r.officeId, itemId: r.itemId, delta: -1, reason: "SERVED" as const, userId: r.userId })),
    }),
  ]);
  console.log(`  ${requests.length} requests over 5 days, ${served.length} served`);
}

/** One delivered order of 48 cans, and the stock it leaves after what was served. */
async function seedPurchase(db: Database, office: { officeId: string; defaultItemId: string }, adminId: string) {
  if (await db.client().purchaseBatch.findFirst({ where: { officeId: office.officeId } })) {
    console.log("  Purchase batch already exists, skipping");
    return;
  }
  const now = new Date();
  const batchId = crypto.randomUUID();
  const totalCents = toCents(DELIVERED_CANS * CAN_PRICE);
  const consumed = await db.client().consumptionEntry.aggregate({ where: { officeId: office.officeId }, _sum: { qty: true } });
  const note = "Initial batch — Migros order";
  await db.commitBatch((batch) => [
    batch.purchaseBatch.createMany({
      data: [
        {
          id: batchId,
          officeId: office.officeId,
          status: "DELIVERED",
          purchasedAt: utcDate(now.getUTCFullYear(), now.getUTCMonth() - 1, 15),
          deliveredAt: utcDate(now.getUTCFullYear(), now.getUTCMonth() - 1, 16),
          orderedByUserId: adminId,
          paidByUserId: adminId,
          totalPriceCents: totalCents,
          notes: note,
        },
      ],
    }),
    batch.purchaseLine.createMany({
      data: [
        { batchId, itemId: office.defaultItemId, qty: DELIVERED_CANS, unitPriceCents: toCents(CAN_PRICE), lineTotalCents: totalCents },
      ],
    }),
    batch.stockMovement.createMany({
      data: [{ officeId: office.officeId, itemId: office.defaultItemId, delta: DELIVERED_CANS, reason: "PURCHASE", note, userId: adminId }],
    }),
    batch.stock.updateMany({
      where: { officeId: office.officeId, itemId: office.defaultItemId },
      data: { currentQty: DELIVERED_CANS - (consumed._sum.qty ?? 0) },
    }),
  ]);
  console.log(`  1 batch: ${DELIVERED_CANS} cans @ CHF ${CAN_PRICE.toFixed(2)}; stock now ${DELIVERED_CANS - (consumed._sum.qty ?? 0)}`);
}

async function seed(db: Database, password: string) {
  console.log("Offices and items:");
  const offices = await seedOffices(db.client());
  const lausanne = offices.get("Lausanne");
  if (!lausanne) throw new Error("Lausanne was not seeded");

  console.log("\nUsers:");
  const userIds = await seedPeople(db, offices, password);
  const adminId = userIds.get("admin@matecrew.local");
  if (!adminId) throw new Error("The admin was not seeded");

  console.log("\nMate sessions:");
  const sessions = await seedSessions(db.client(), lausanne.officeId);
  console.log(`  ${sessions.length} sessions for Lausanne (Mon-Fri, 2/day)`);

  console.log("\nDaily requests:");
  const lausanneUsers = PEOPLE.filter((p) => p.offices.includes("Lausanne"))
    .map((p) => userIds.get(p.email))
    .filter((id): id is string => !!id);
  await seedRequests(db, lausanne, lausanneUsers, sessions);

  console.log("\nPurchases:");
  await seedPurchase(db, lausanne, adminId);

  console.log("\nSeed complete. Test accounts (password: SEED_PASSWORD):");
  for (const person of PEOPLE) {
    console.log(`  ${person.email.padEnd(24)} ${person.roles.join("+")} in ${person.offices.join(", ")}`);
  }
}

const seedPassword = process.env.SEED_PASSWORD;
if (!seedPassword || seedPassword.length < 8) {
  throw new Error("Set SEED_PASSWORD (8 characters or more): every demo account gets it.");
}
if (process.argv.includes("--sqlite")) {
  await seed(sqliteDatabaseAt(process.env.DATABASE_URL ?? "file:.data/matecrew.sqlite"), seedPassword);
} else {
  await withLocalD1(({ client, commitBatch }) => seed({ client: () => client, commitBatch }, seedPassword));
}
