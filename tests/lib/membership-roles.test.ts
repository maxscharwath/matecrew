import { test } from "node:test";
import assert from "node:assert/strict";
import { hasRoleWhere, roleList, withRoleList } from "../../src/lib/membership-roles";
import { findByIdOrName, sameName } from "../../src/lib/mcp/name-match";

test("roleList turns role rows into a Role[]", () => {
  assert.deepEqual(roleList({ roles: [{ role: "ADMIN" }, { role: "USER" }] }), ["ADMIN", "USER"]);
  assert.deepEqual(roleList({ roles: [] }), []);
});

test("withRoleList keeps the other fields and flattens roles", () => {
  const membership = { id: "m1", officeId: "o1", roles: [{ role: "USER" as const }] };
  assert.deepEqual(withRoleList(membership), { id: "m1", officeId: "o1", roles: ["USER"] });
});

test("hasRoleWhere filters on a role row", () => {
  assert.deepEqual(hasRoleWhere("ADMIN"), { roles: { some: { role: "ADMIN" } } });
});

test("sameName ignores case, accents' case and surrounding spaces", () => {
  assert.equal(sameName("Maté Zero", "  MATÉ ZERO "), true);
  assert.equal(sameName("Maté", "Mate"), false);
});

test("findByIdOrName prefers the id, then the name", () => {
  const rows = [
    { id: "a", name: "Ginger" },
    { id: "b", name: "a" },
  ];
  assert.equal(findByIdOrName(rows, "a")?.id, "a");
  assert.equal(findByIdOrName(rows, " ginger ")?.id, "a");
  assert.equal(findByIdOrName(rows, "Lemon"), undefined);
});
