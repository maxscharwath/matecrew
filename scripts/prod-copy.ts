/**
 * Makes the local copy of production safe and usable (see
 * scripts/clone-prod-db.sh): nothing in it points at the real Slack, and the
 * seed's admin (admin@matecrew.local / admin123) is an admin of every office,
 * since production accounts sign in through SSO that does not run locally.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

if (!process.env.DATABASE_URL?.includes("matecrew_prod")) {
  throw new Error("Refusing to run outside the matecrew_prod copy.");
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const auth = betterAuth({ database: prismaAdapter(prisma, { provider: "postgresql" }), emailAndPassword: { enabled: true } });

await prisma.office.updateMany({ data: { slackChannelId: null, slackChannelLabel: null } });
await prisma.user.updateMany({ data: { slackUserId: null } });

const email = "admin@matecrew.local";
if (!(await prisma.user.findFirst({ where: { email } }))) {
  await auth.api.signUpEmail({ body: { name: "Admin local", email, password: "admin123" } });
}
const admin = await prisma.user.findFirstOrThrow({ where: { email } });
const offices = await prisma.office.findMany({ select: { id: true, name: true } });
for (const office of offices) {
  await prisma.membership.upsert({
    where: { userId_officeId: { userId: admin.id, officeId: office.id } },
    update: { roles: ["ADMIN", "USER"] },
    create: { userId: admin.id, officeId: office.id, roles: ["ADMIN", "USER"] },
  });
}
console.log(`Slack cleared; ${email} is admin of ${offices.map((o) => o.name).join(", ")}.`);
await prisma.$disconnect();
