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

async function createUser(
  name: string,
  email: string,
  password: string,
  roles: ("ADMIN" | "RUNNER" | "EMPLOYEE")[],
  officeId: string
) {
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    console.log(`  User ${email} already exists, skipping`);
    return existing;
  }

  await auth.api.signUpEmail({
    body: { name, email, password },
  });

  const user = await prisma.user.update({
    where: { email },
    data: { roles, officeId },
  });

  console.log(`  Created ${roles.join("+").toLowerCase()}: ${email} (password: ${password})`);
  return user;
}

async function main() {
  console.log("Seeding database...\n");

  // ─── Offices ───────────────────────────────────────────
  console.log("Offices:");

  const offices = [
    { name: "Lausanne", timezone: "Europe/Zurich", dailyPostTime: "10:00", lowStockThreshold: 5 },
    { name: "Genève", timezone: "Europe/Zurich", dailyPostTime: "10:00", lowStockThreshold: 5 },
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

  // ─── Users ─────────────────────────────────────────────
  console.log("\nUsers:");

  const admin = await createUser(
    "Admin",
    "admin@matecrew.local",
    "admin123",
    ["ADMIN", "EMPLOYEE"],
    createdOffices["Lausanne"].id
  );

  const runner = await createUser(
    "Marie Runner",
    "marie@matecrew.local",
    "runner123",
    ["RUNNER", "EMPLOYEE"],
    createdOffices["Lausanne"].id
  );

  const employees = [
    { name: "Alice Dupont", email: "alice@matecrew.local", office: "Lausanne" },
    { name: "Bob Martin", email: "bob@matecrew.local", office: "Lausanne" },
    { name: "Claire Favre", email: "claire@matecrew.local", office: "Genève" },
  ];

  const createdEmployees = [];
  for (const emp of employees) {
    const user = await createUser(
      emp.name,
      emp.email,
      "employee123",
      ["EMPLOYEE"],
      createdOffices[emp.office].id
    );
    createdEmployees.push(user);
  }

  // ─── Sample daily requests (last 5 days) ───────────────
  console.log("\nDaily requests:");

  const allLausanneUsers = [admin, runner, ...createdEmployees.filter((_, i) => i < 2)];
  const today = new Date();
  let requestCount = 0;

  for (let daysAgo = 4; daysAgo >= 0; daysAgo--) {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(0, 0, 0, 0);

    // Each day, some users request (randomized but deterministic)
    const requesters = allLausanneUsers.filter((_, i) => (daysAgo + i) % 3 !== 0);

    for (const user of requesters) {
      const status = daysAgo > 0 ? "SERVED" : "REQUESTED"; // today's are still pending

      await prisma.dailyRequest.upsert({
        where: {
          date_officeId_userId: {
            date,
            officeId: createdOffices["Lausanne"].id,
            userId: user.id,
          },
        },
        update: {},
        create: {
          date,
          officeId: createdOffices["Lausanne"].id,
          userId: user.id,
          status,
        },
      });
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

  // ─── Sample purchase batch ─────────────────────────────
  console.log("\nPurchase batches:");

  const existingBatch = await prisma.purchaseBatch.findFirst({
    where: { officeId: createdOffices["Lausanne"].id },
  });

  if (!existingBatch) {
    await prisma.purchaseBatch.create({
      data: {
        officeId: createdOffices["Lausanne"].id,
        orderedByUserId: admin.id,
        paidByUserId: admin.id,
        qty: 48,
        unitPrice: 2.5,
        totalPrice: 120,
        notes: "Initial batch — Migros order",
        purchasedAt: new Date(today.getFullYear(), today.getMonth(), 1),
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
  console.log("  admin@matecrew.local   / admin123    (Admin, Lausanne)");
  console.log("  marie@matecrew.local   / runner123   (Runner, Lausanne)");
  console.log("  alice@matecrew.local   / employee123 (Employee, Lausanne)");
  console.log("  bob@matecrew.local     / employee123 (Employee, Lausanne)");
  console.log("  claire@matecrew.local  / employee123 (Employee, Genève)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
