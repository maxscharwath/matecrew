import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { BatchConflictError, expectRows, type Database } from "../../src/platform/ports/database";
import { stockAtLeast, stockDeltaOps, stockUnchanged } from "../../src/lib/stock";
import { retryOnConflict } from "../../src/lib/prisma";
import { ADAPTERS, d1Database } from "./support/databases";

/** An office with one item, 5 cans in its pool, and a member. */
async function shelf(db: Database) {
  const office = await db.client().office.create({ data: { name: `Office ${crypto.randomUUID()}` } });
  const item = await db.client().item.create({ data: { officeId: office.id, name: "Maté" } });
  const user = await db.client().user.create({ data: { name: "Ana", email: `${crypto.randomUUID()}@example.com` } });
  await db.client().stock.create({ data: { officeId: office.id, itemId: item.id, currentQty: 5 } });
  return { officeId: office.id, itemId: item.id, userId: user.id };
}

async function stockOf(db: Database, officeId: string, itemId: string) {
  const row = await db.client().stock.findUnique({ where: { officeId_itemId: { officeId, itemId } } });
  return row?.currentQty;
}

for (const adapter of ADAPTERS) {
  describe(adapter.name, () => {
    test("commits every write and reports the rows each touched", async () => {
      const db = adapter.open();
      const { officeId, itemId, userId } = await shelf(db);
      const rows = await db.commitBatch((batch) => [
        batch.consumptionEntry.createMany({
          data: [1, 2].map(() => ({ officeId, userId, itemId, date: new Date("2026-03-02T00:00:00Z"), qty: 1 })),
        }),
        ...stockDeltaOps(batch, { officeId, itemId, delta: -2, reason: "SERVED", userId }),
      ]);
      assert.deepEqual(rows, [2, 1, 1]);
      assert.equal(await stockOf(db, officeId, itemId), 3);
      assert.equal(await db.client().stockMovement.count({ where: { officeId, itemId } }), 1);
    });

    test("a failed guard rolls back the writes before and after it", async () => {
      const db = adapter.open();
      const { officeId, itemId, userId } = await shelf(db);
      await assert.rejects(
        db.commitBatch((batch) => [
          batch.consumptionEntry.createMany({
            data: [{ officeId, userId, itemId, date: new Date("2026-03-02T00:00:00Z"), qty: 9 }],
          }),
          stockAtLeast(batch, officeId, itemId, 9),
          ...stockDeltaOps(batch, { officeId, itemId, delta: -9, reason: "SERVED", userId }),
        ]),
        (error) => error instanceof BatchConflictError && error.reason === "guard",
      );
      assert.equal(await db.client().consumptionEntry.count({ where: { officeId } }), 0);
      assert.equal(await db.client().stockMovement.count({ where: { officeId } }), 0);
      assert.equal(await stockOf(db, officeId, itemId), 5);
    });

    test("a guard that holds lets the batch through", async () => {
      const db = adapter.open();
      const { officeId, itemId, userId } = await shelf(db);
      await db.commitBatch((batch) => [
        stockUnchanged(batch, officeId, itemId, 5),
        ...stockDeltaOps(batch, { officeId, itemId, delta: -5, reason: "SERVED", userId }),
      ]);
      assert.equal(await stockOf(db, officeId, itemId), 0);
    });

    test("an absent pool must still be absent, a present one at the level read", async () => {
      const db = adapter.open();
      const { officeId, userId } = await shelf(db);
      const other = await db.client().item.create({ data: { officeId, name: "Ginger" } });
      // No pool row yet: the guard expects none, and the delta creates it.
      await db.commitBatch((batch) => [
        stockUnchanged(batch, officeId, other.id, undefined),
        ...stockDeltaOps(batch, { officeId, itemId: other.id, delta: 4, reason: "ADJUSTMENT", userId }),
      ]);
      assert.equal(await stockOf(db, officeId, other.id), 4);
      // Read as absent, but it exists now: conflict, nothing written.
      await assert.rejects(
        db.commitBatch((batch) => [
          stockUnchanged(batch, officeId, other.id, undefined),
          ...stockDeltaOps(batch, { officeId, itemId: other.id, delta: 4, reason: "ADJUSTMENT", userId }),
        ]),
        BatchConflictError,
      );
      assert.equal(await stockOf(db, officeId, other.id), 4);
    });

    test("a one-time state is redeemed once: the second redemption rolls back whole", async () => {
      const db = adapter.open();
      const { officeId, itemId } = await shelf(db);
      const link = await db.client().deviceLink.create({
        data: { deviceCodeHash: crypto.randomUUID(), userCode: crypto.randomUUID().slice(0, 8), hardwareId: "AA", expiresAt: new Date(Date.now() + 60_000), officeId },
      });
      const redeem = (tokenHash: string) =>
        db.commitBatch((batch) => [
          expectRows(batch.deviceLink.updateMany({ where: { id: link.id, redeemedAt: null }, data: { redeemedAt: new Date() } }), 1),
          batch.device.createMany({ data: [{ officeId, name: "Frigo", hardwareId: "AA", tokenHash, leftItemId: itemId }] }),
        ]);
      await redeem("first");
      await assert.rejects(redeem("second"), BatchConflictError);
      assert.deepEqual(
        (await db.client().device.findMany({ where: { officeId }, select: { tokenHash: true } })).map((d) => d.tokenHash),
        ["first"],
      );
    });

    test("a unique key taken in between is a conflict, and nothing is written", async () => {
      const db = adapter.open();
      const { officeId } = await shelf(db);
      await assert.rejects(
        db.commitBatch((batch) => [
          batch.item.createMany({ data: [{ officeId, name: "Zero" }] }),
          batch.item.createMany({ data: [{ officeId, name: "Maté" }] }),
        ]),
        (error) => error instanceof BatchConflictError && error.reason === "unique",
      );
      assert.equal(await db.client().item.count({ where: { officeId, name: "Zero" } }), 0);
    });

    test("retryOnConflict reads again and commits on fresh data", async () => {
      const db = adapter.open();
      const { officeId, itemId, userId } = await shelf(db);
      let attempts = 0;
      await retryOnConflict(async () => {
        attempts += 1;
        const read = await stockOf(db, officeId, itemId);
        // Someone takes a can between the first read and its batch.
        if (attempts === 1) await db.commitBatch((batch) => stockDeltaOps(batch, { officeId, itemId, delta: -1, reason: "SERVED", userId }));
        await db.commitBatch((batch) => [
          stockUnchanged(batch, officeId, itemId, read),
          ...stockDeltaOps(batch, { officeId, itemId, delta: -1, reason: "SERVED", userId }),
        ]);
      });
      assert.equal(attempts, 2);
      assert.equal(await stockOf(db, officeId, itemId), 3);
    });
  });
}

describe("cloudflare (D1 batch) compiling", () => {
  test("refuses a write that would read in the middle of a batch", async () => {
    const db = d1Database();
    const { officeId } = await shelf(db);
    await assert.rejects(
      db.commitBatch((batch) => [
        // Smuggled past the types: `create` reads its row back, which a batch cannot do.
        (batch.office as unknown as { create: (args: object) => ReturnType<typeof batch.office.createMany> }).create({ data: { name: "Smuggled" } }),
      ]),
      /only hold writes that read nothing back/,
    );
    assert.equal(await db.client().office.count({ where: { name: "Smuggled" } }), 0);
    assert.ok(officeId);
  });

  test("refuses a guard on a write that compiles to several statements", async () => {
    const db = d1Database();
    const { officeId, itemId, userId } = await shelf(db);
    // Over D1's 98 bound values per statement, createMany is split in several INSERTs.
    const many = Array.from({ length: 40 }, () => ({ officeId, userId, itemId, date: new Date("2026-03-02T00:00:00Z"), qty: 1 }));
    await assert.rejects(
      db.commitBatch((batch) => [expectRows(batch.consumptionEntry.createMany({ data: many }), 40)]),
      /must compile to one statement/,
    );
    assert.equal(await db.client().consumptionEntry.count({ where: { officeId } }), 0);
  });
});
