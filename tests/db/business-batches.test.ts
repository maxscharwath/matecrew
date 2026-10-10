import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Database } from "../../src/platform/ports/database";
import { ADAPTERS } from "./support/databases";

/**
 * The app's own read-compute-commit functions, run on each adapter. The Node
 * platform's database is swapped for the adapter under test through the
 * process-wide handle `@/platform` resolves (`globalThis.nodeDatabase`).
 */
const holder = globalThis as unknown as { nodeDatabase?: Database };

async function onAdapter(open: () => Database) {
  const db = open();
  holder.nodeDatabase = db;
  const client = db.client();
  const office = await client.office.create({ data: { name: `Office ${crypto.randomUUID()}`, timezone: "Europe/Zurich" } });
  const item = await client.item.create({ data: { officeId: office.id, name: "Maté", isDefault: true } });
  const [ana, ben] = await Promise.all(
    ["ana", "ben"].map((name) => client.user.create({ data: { name, email: `${name}-${crypto.randomUUID()}@example.com` } })),
  );
  await client.stock.create({ data: { officeId: office.id, itemId: item.id, currentQty: 10 } });
  return { db, client, officeId: office.id, itemId: item.id, ana: ana.id, ben: ben.id };
}

afterEach(() => {
  delete holder.nodeDatabase;
});

for (const adapter of ADAPTERS) {
  describe(adapter.name, () => {
    test("a stock count writes the count, its lines and the movements together", async () => {
      const { client, officeId, itemId, ana } = await onAdapter(adapter.open);
      const { recordStockCount } = await import("../../src/lib/stock-count");
      const outcome = await recordStockCount({ officeId, userId: ana, counts: [{ itemId, countedQty: 7 }] });
      assert.ok(outcome.ok);
      assert.equal(outcome.result.missing, 3);
      assert.equal((await client.stock.findFirstOrThrow({ where: { officeId, itemId } })).currentQty, 7);
      const count = await client.stockCount.findFirstOrThrow({ where: { officeId }, include: { lines: true } });
      assert.deepEqual(count.lines.map((l) => [l.expectedQty, l.countedQty, l.delta]), [[10, 7, -3]]);
      assert.equal(await client.stockMovement.count({ where: { officeId, reason: "INVENTORY", delta: -3 } }), 1);
    });

    test("an unknown item in a count writes nothing", async () => {
      const { client, officeId, itemId, ana } = await onAdapter(adapter.open);
      const { recordStockCount } = await import("../../src/lib/stock-count");
      const outcome = await recordStockCount({
        officeId,
        userId: ana,
        counts: [{ itemId, countedQty: 1 }, { itemId: "missing", countedQty: 1 }],
      });
      assert.deepEqual(outcome, { ok: false, reason: "unknown_item", itemId: "missing" });
      assert.equal(await client.stockCount.count({ where: { officeId } }), 0);
      assert.equal((await client.stock.findFirstOrThrow({ where: { officeId, itemId } })).currentQty, 10);
    });

    test("serving a round consumes and destocks once, and a second serve finds nothing", async () => {
      const { client, officeId, itemId, ana, ben } = await onAdapter(adapter.open);
      const { serveSession } = await import("../../src/lib/serve-session");
      const date = new Date("2026-03-02T00:00:00Z");
      await client.dailyRequest.createMany({
        data: [ana, ben].map((userId) => ({ officeId, userId, itemId, date, mateSessionId: null })),
      });
      const first = await serveSession({ officeId, mateSessionId: null, date, actingUserId: ana });
      const second = await serveSession({ officeId, mateSessionId: null, date, actingUserId: ana });
      assert.deepEqual(first, { kind: "ok", servedCount: 2 });
      assert.deepEqual(second, { kind: "empty" });
      assert.equal(await client.consumptionEntry.count({ where: { officeId } }), 2);
      assert.equal((await client.stock.findFirstOrThrow({ where: { officeId, itemId } })).currentQty, 8);
    });

    test("a consumption is cancelled once: the second cancel puts nothing back", async () => {
      const { client, officeId, itemId, ana } = await onAdapter(adapter.open);
      const { cancelConsumptionEntry } = await import("../../src/lib/cancel-consumption");
      const entry = await client.consumptionEntry.create({
        data: { officeId, userId: ana, itemId, date: new Date("2026-03-02T00:00:00Z"), qty: 2 },
      });
      const args = { officeId, userId: ana, entryId: entry.id, note: "test" };
      assert.equal(await cancelConsumptionEntry(args), "cancelled");
      assert.equal(await cancelConsumptionEntry(args), "already_cancelled");
      assert.equal((await client.stock.findFirstOrThrow({ where: { officeId, itemId } })).currentQty, 12);
    });

    test("merging accounts unions roles, moves rows and deletes the source", async () => {
      const { db, client, officeId, itemId } = await onAdapter(adapter.open);
      const { createMembershipWrites, roleList, rolesSelect } = await import("../../src/lib/membership-roles");
      const { mergeAccounts } = await import("../../src/lib/account-merge");
      const id = crypto.randomUUID().slice(0, 8);
      const target = await client.user.create({ data: { name: "Zoé", email: `zoe.${id}@owt.swiss` } });
      const source = await client.user.create({ data: { name: "Zoé", email: `zoe.${id}@openwt.com`, slackUserId: `U${id}` } });
      await db.commitBatch((batch) => [
        ...createMembershipWrites(batch, { id: `t-${id}`, userId: target.id, officeId, roles: ["USER"] }),
        ...createMembershipWrites(batch, { id: `s-${id}`, userId: source.id, officeId, roles: ["ADMIN"] }),
      ]);
      await client.consumptionEntry.create({ data: { officeId, userId: source.id, itemId, date: new Date("2026-03-02T00:00:00Z") } });

      // owt.swiss and openwt.com are aliases by default (src/lib/email-identity.ts).
      await mergeAccounts(target.id, source.id);

      const membership = await client.membership.findFirstOrThrow({ where: { userId: target.id, officeId }, include: rolesSelect });
      assert.deepEqual(roleList(membership), ["ADMIN", "USER"]);
      assert.equal(await client.user.count({ where: { id: source.id } }), 0);
      assert.equal(await client.consumptionEntry.count({ where: { userId: target.id } }), 1);
      assert.equal((await client.user.findUniqueOrThrow({ where: { id: target.id } })).slackUserId, `U${id}`);
    });
  });
}
