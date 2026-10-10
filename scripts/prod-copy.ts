/**
 * Makes the local copy of production safe and usable (see
 * scripts/clone-prod-db.sh): nothing in it points at the real Slack, and a
 * local admin (admin@matecrew.local, password SEED_PASSWORD) is an admin of
 * every office, since production accounts sign in through SSO that does not
 * run locally.
 *
 *   DATABASE_URL=file:.data/prod-copy.sqlite SEED_PASSWORD=… bun scripts/prod-copy.ts
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { replaceRolesWrites, createMembershipWrites } from "../src/lib/membership-roles";
import { sqliteDatabaseAt } from "../src/platform/node/database";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("prod-copy")) {
  throw new Error("Refusing to run outside the prod-copy database (DATABASE_URL=file:.data/prod-copy.sqlite).");
}
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 8) throw new Error("Set SEED_PASSWORD (8 characters or more) for the local admin.");

const db = sqliteDatabaseAt(url);
const prisma = db.client();
const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite", transaction: false }),
  emailAndPassword: { enabled: true },
});

await db.commitBatch((batch) => [
  batch.office.updateMany({ data: { slackChannelId: null, slackChannelLabel: null } }),
  batch.user.updateMany({ data: { slackUserId: null } }),
]);

const email = "admin@matecrew.local";
if (!(await prisma.user.findFirst({ where: { email } }))) {
  await auth.api.signUpEmail({ body: { name: "Admin local", email, password } });
}
const admin = await prisma.user.findFirstOrThrow({ where: { email } });
const [offices, memberships] = await Promise.all([
  prisma.office.findMany({ select: { id: true, name: true } }),
  prisma.membership.findMany({ where: { userId: admin.id }, select: { id: true, officeId: true } }),
]);
const membershipOf = new Map(memberships.map((m) => [m.officeId, m.id]));

// One batch: every office gets the admin as ADMIN and USER, new or existing membership alike.
await db.commitBatch((batch) =>
  offices.flatMap((office) => {
    const existing = membershipOf.get(office.id);
    return existing
      ? replaceRolesWrites(batch, existing, ["ADMIN", "USER"])
      : createMembershipWrites(batch, { id: crypto.randomUUID(), userId: admin.id, officeId: office.id, roles: ["ADMIN", "USER"] });
  }),
);
console.log(`Slack cleared; ${email} is admin of ${offices.map((o) => o.name).join(", ")}.`);
