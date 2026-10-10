import { test } from "node:test";
import assert from "node:assert/strict";
import { connectD1 } from "../../src/platform/cloudflare/d1-database";
import { BatchConflictError } from "../../src/platform/ports/database";
import {
  createMembershipWrites,
  officeKeepsAnAdmin,
  replaceRolesWrites,
  roleList,
  rolesSelect,
} from "../../src/lib/membership-roles";
import { migratedSqlite, SqliteD1 } from "./support/sqlite-d1";

async function officeWithTwoAdmins() {
  const db = connectD1(new SqliteD1(migratedSqlite()).asBinding());
  const office = await db.client.office.create({ data: { name: "Lausanne" } });
  const [ana, ben] = await Promise.all(
    ["ana", "ben"].map((name) => db.client.user.create({ data: { name, email: `${name}@example.com` } })),
  );
  await db.commitBatch((batch) => [
    ...createMembershipWrites(batch, { id: "m-ana", userId: ana.id, officeId: office.id, roles: ["ADMIN", "USER"] }),
    ...createMembershipWrites(batch, { id: "m-ben", userId: ben.id, officeId: office.id, roles: ["ADMIN"] }),
  ]);
  return { db, officeId: office.id };
}

async function rolesOf(db: ReturnType<typeof connectD1>, membershipId: string) {
  const membership = await db.client.membership.findUnique({ where: { id: membershipId }, include: rolesSelect });
  return membership ? roleList(membership) : null;
}

test("demoting one of two admins commits", async () => {
  const { db, officeId } = await officeWithTwoAdmins();
  await db.commitBatch((batch) => [
    ...replaceRolesWrites(batch, "m-ana", ["USER"]),
    officeKeepsAnAdmin(batch, officeId),
  ]);
  assert.deepEqual(await rolesOf(db, "m-ana"), ["USER"]);
});

test("demoting the last admin rolls the whole batch back", async () => {
  const { db, officeId } = await officeWithTwoAdmins();
  await db.commitBatch((batch) => [...replaceRolesWrites(batch, "m-ana", ["USER"]), officeKeepsAnAdmin(batch, officeId)]);

  await assert.rejects(
    db.commitBatch((batch) => [...replaceRolesWrites(batch, "m-ben", ["USER"]), officeKeepsAnAdmin(batch, officeId)]),
    (error) => error instanceof BatchConflictError && error.reason === "guard",
  );
  assert.deepEqual(await rolesOf(db, "m-ben"), ["ADMIN"]);
});

test("removing the last admin rolls the whole batch back", async () => {
  const { db, officeId } = await officeWithTwoAdmins();
  await db.commitBatch((batch) => [batch.membership.deleteMany({ where: { id: "m-ana" } }), officeKeepsAnAdmin(batch, officeId)]);

  await assert.rejects(
    db.commitBatch((batch) => [batch.membership.deleteMany({ where: { id: "m-ben" } }), officeKeepsAnAdmin(batch, officeId)]),
    BatchConflictError,
  );
  assert.deepEqual(await rolesOf(db, "m-ben"), ["ADMIN"]);
  assert.equal(await rolesOf(db, "m-ana"), null);
});
