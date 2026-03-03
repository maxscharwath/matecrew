import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
});

async function createUser(name: string, email: string, password: string) {
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    console.log(`  User ${email} already exists, skipping`);
    return existing;
  }

  await auth.api.signUpEmail({
    body: { name, email, password },
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  console.log(`  Created: ${email} (password: ${password})`);
  return user;
}

async function createMembership(
  userId: string,
  officeId: string,
  roles: ("ADMIN" | "USER")[]
) {
  await prisma.membership.upsert({
    where: { userId_officeId: { userId, officeId } },
    update: { roles },
    create: { userId, officeId, roles },
  });
}

async function main() {
  console.log("Seeding database...\n");

  // ─── Offices ───────────────────────────────────────────
  console.log("Offices:");

  const offices = [
    { name: "Lausanne", timezone: "Europe/Zurich", lowStockThreshold: 30 },
    { name: "Genève", timezone: "Europe/Zurich", lowStockThreshold: 30 },
  ];

  const createdOffices: Record<string, { id: string; name: string }> = {};

  for (const office of offices) {
    const result = await prisma.office.upsert({
      where: { name: office.name },
      update: {},
      create: office,
    });
    createdOffices[office.name] = result;
    console.log(`  ${result.name} (${result.id})`);
  }

  // ─── Stock ─────────────────────────────────────────────
  console.log("\nStock:");

  for (const office of Object.values(createdOffices)) {
    await prisma.stock.upsert({
      where: { officeId: office.id },
      update: {},
      create: { officeId: office.id, currentQty: 24 },
    });
    console.log(`  ${office.name}: 24 cans`);
  }

  // ─── Users + Memberships ──────────────────────────────
  console.log("\nUsers:");

  const admin = await createUser("Admin", "admin@matecrew.local", "admin123");
  // Admin gets membership in BOTH offices (demo org switching)
  await createMembership(admin.id, createdOffices["Lausanne"].id, ["ADMIN", "USER"]);
  await createMembership(admin.id, createdOffices["Genève"].id, ["ADMIN", "USER"]);
  console.log("    → Memberships: Lausanne (Admin), Genève (Admin)");

  const marie = await createUser("Marie Runner", "marie@matecrew.local", "runner123");
  await createMembership(marie.id, createdOffices["Lausanne"].id, ["USER"]);
  console.log("    → Membership: Lausanne (User)");

  const employees = [
    { name: "Alice Dupont", email: "alice@matecrew.local", office: "Lausanne" },
    { name: "Bob Martin", email: "bob@matecrew.local", office: "Lausanne" },
    { name: "Claire Favre", email: "claire@matecrew.local", office: "Genève" },
  ];

  const createdEmployees = [];
  for (const emp of employees) {
    const user = await createUser(emp.name, emp.email, "employee123");
    await createMembership(user.id, createdOffices[emp.office].id, ["USER"]);
    console.log(`    → Membership: ${emp.office} (User)`);
    createdEmployees.push(user);
  }

  // ─── Mate Sessions (weekly schedule) ────────────────────
  console.log("\nMate sessions:");

  const lausanneId = createdOffices["Lausanne"].id;
  const sessionData = [
    { dayOfWeek: 1, startTime: "08:00", cutoffTime: "10:00", label: "Matin" },
    { dayOfWeek: 1, startTime: "14:00", cutoffTime: "16:00", label: "Après-midi" },
    { dayOfWeek: 2, startTime: "08:00", cutoffTime: "10:00", label: "Matin" },
    { dayOfWeek: 2, startTime: "14:00", cutoffTime: "16:00", label: "Après-midi" },
    { dayOfWeek: 3, startTime: "08:00", cutoffTime: "10:00", label: "Matin" },
    { dayOfWeek: 3, startTime: "14:00", cutoffTime: "16:00", label: "Après-midi" },
    { dayOfWeek: 4, startTime: "08:00", cutoffTime: "10:00", label: "Matin" },
    { dayOfWeek: 4, startTime: "14:00", cutoffTime: "16:00", label: "Après-midi" },
    { dayOfWeek: 5, startTime: "08:00", cutoffTime: "10:00", label: "Matin" },
    { dayOfWeek: 5, startTime: "14:00", cutoffTime: "16:00", label: "Après-midi" },
  ];

  const createdSessions: { id: string; dayOfWeek: number; startTime: string }[] = [];
  for (const s of sessionData) {
    const session = await prisma.mateSession.upsert({
      where: {
        officeId_dayOfWeek_startTime: {
          officeId: lausanneId,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
        },
      },
      update: {},
      create: { officeId: lausanneId, ...s },
    });
    createdSessions.push(session);
  }
  console.log(`  Created ${createdSessions.length} sessions for Lausanne (Mon-Fri, 2/day)`);

  // ─── Sample daily requests (last 5 days) ───────────────
  console.log("\nDaily requests:");

  const allLausanneUsers = [admin, marie, ...createdEmployees.filter((_, i) => i < 2)];
  const today = new Date();
  let requestCount = 0;

  for (let daysAgo = 4; daysAgo >= 0; daysAgo--) {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(0, 0, 0, 0);

    // Find the morning session for this day of week
    const dow = date.getDay();
    const daySession = createdSessions.find(
      (s) => s.dayOfWeek === dow && s.startTime === "08:00",
    );

    const requesters = allLausanneUsers.filter((_, i) => (daysAgo + i) % 3 !== 0);

    for (const user of requesters) {
      const status = daysAgo > 0 ? "SERVED" : "REQUESTED";

      const existing = await prisma.dailyRequest.findFirst({
        where: {
          date,
          officeId: lausanneId,
          userId: user.id,
          mateSessionId: daySession?.id ?? null,
        },
      });
      if (!existing) {
        await prisma.dailyRequest.create({
          data: {
            date,
            officeId: lausanneId,
            userId: user.id,
            mateSessionId: daySession?.id ?? null,
            status,
          },
        });
      }
      requestCount++;
    }
  }

  console.log(`  Created ${requestCount} requests across 5 days`);

  // ─── Consumption entries for served requests ───────────
  console.log("\nConsumption entries:");

  const servedRequests = await prisma.dailyRequest.findMany({
    where: { status: "SERVED" },
  });

  let consumptionCount = 0;
  for (const req of servedRequests) {
    const existing = await prisma.consumptionEntry.findFirst({
      where: { userId: req.userId, date: req.date, officeId: req.officeId },
    });
    if (!existing) {
      await prisma.consumptionEntry.create({
        data: {
          officeId: req.officeId,
          userId: req.userId,
          date: req.date,
          qty: 1,
          source: "DAILY_REQUEST",
        },
      });
      consumptionCount++;
    }
  }

  console.log(`  Created ${consumptionCount} entries from served requests`);

  // ─── Stock movements for served requests ───────────────
  console.log("\nStock movements:");

  for (const req of servedRequests) {
    await prisma.stockMovement.create({
      data: {
        officeId: req.officeId,
        delta: -1,
        reason: "SERVED",
        userId: req.userId,
      },
    });
  }
  console.log(`  Created ${servedRequests.length} SERVED movements`);

  // ─── Sample purchase batch ─────────────────────────────
  console.log("\nPurchase batches:");

  const existingBatch = await prisma.purchaseBatch.findFirst({
    where: { officeId: createdOffices["Lausanne"].id },
  });

  if (!existingBatch) {
    await prisma.purchaseBatch.create({
      data: {
        officeId: createdOffices["Lausanne"].id,
        status: "DELIVERED",
        deliveredAt: new Date(today.getFullYear(), today.getMonth() - 1, 16),
        orderedByUserId: admin.id,
        paidByUserId: admin.id,
        qty: 48,
        unitPrice: 2.5,
        totalPrice: 120,
        notes: "Initial batch — Migros order",
        purchasedAt: new Date(today.getFullYear(), today.getMonth() - 1, 15),
      },
    });

    // Stock movement for purchase
    await prisma.stockMovement.create({
      data: {
        officeId: createdOffices["Lausanne"].id,
        delta: 48,
        reason: "PURCHASE",
        note: "Initial batch — Migros order",
        userId: admin.id,
      },
    });

    console.log("  Created 1 batch: 48 cans @ CHF 2.50 (Lausanne)");
  } else {
    console.log("  Purchase batch already exists, skipping");
  }

  // ─── Update stock to reflect consumption ───────────────
  const totalConsumedLausanne = await prisma.consumptionEntry.aggregate({
    where: { officeId: createdOffices["Lausanne"].id },
    _sum: { qty: true },
  });

  await prisma.stock.update({
    where: { officeId: createdOffices["Lausanne"].id },
    data: { currentQty: 48 - (totalConsumedLausanne._sum.qty ?? 0) },
  });

  console.log(
    `\nStock adjusted: Lausanne now has ${48 - (totalConsumedLausanne._sum.qty ?? 0)} cans`
  );

  // ─── Summary ───────────────────────────────────────────
  console.log("\n✓ Seed complete!");
  console.log("\nTest accounts:");
  console.log("  admin@matecrew.local   / admin123    (Admin in Lausanne + Genève)");
  console.log("  marie@matecrew.local   / runner123   (User in Lausanne)");
  console.log("  alice@matecrew.local   / employee123 (Employee in Lausanne)");
  console.log("  bob@matecrew.local     / employee123 (Employee in Lausanne)");
  console.log("  claire@matecrew.local  / employee123 (Employee in Genève)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
