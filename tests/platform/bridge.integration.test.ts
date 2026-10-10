import { describe, test } from "node:test";
import assert from "node:assert/strict";
// Bun's runner ignores node:test hook timeouts, and starting wrangler takes longer than its default 5 s.
import { afterAll, beforeAll } from "bun:test";
import { BRIDGE_PREFIX, BridgeHeader, sha256Hex, signatureHeaders, storageRoute } from "../../src/platform/cloudflare/bridge/protocol";
import { connectD1 } from "../../src/platform/cloudflare/d1-database";
import { BatchConflictError, type Database } from "../../src/platform/ports/database";
import { readBlobBytes, type BlobStore } from "../../src/platform/ports/storage";
import { connectBridge } from "../../src/platform/vercel/bridge";
import { bridgeJobQueue } from "../../src/platform/vercel/jobs";
import { RemoteD1Database } from "../../src/platform/vercel/remote-d1";
import { bridgeBlobStore } from "../../src/platform/vercel/storage";
import { stockAtLeast, stockDeltaOps } from "../../src/lib/stock";
import { startBridgeServer, type BridgeServer } from "./support/bridge-server";

/**
 * The Vercel adapters against the real bridge: `wrangler dev` runs it in
 * workerd on local D1, R2 and Queue bindings, so batches, guards and errors
 * are D1's own.
 */

let server: BridgeServer;
let db: Database;
let storage: BlobStore;

beforeAll(async () => {
  server = await startBridgeServer();
  const bridge = connectBridge(server.origin, server.secret);
  const connection = connectD1(new RemoteD1Database(bridge));
  db = { client: () => connection.client, commitBatch: connection.commitBatch };
  storage = bridgeBlobStore(bridge);
}, 120_000);

afterAll(() => server?.stop(), 30_000);

/** An office with one item, 5 cans in its pool, and a member. */
async function shelf() {
  const office = await db.client().office.create({ data: { name: `Office ${crypto.randomUUID()}` } });
  const item = await db.client().item.create({ data: { officeId: office.id, name: "Maté" } });
  const user = await db.client().user.create({ data: { name: "Ana", email: `${crypto.randomUUID()}@example.com` } });
  await db.client().stock.create({ data: { officeId: office.id, itemId: item.id, currentQty: 5 } });
  return { officeId: office.id, itemId: item.id, userId: user.id };
}

async function stockOf(officeId: string, itemId: string) {
  const row = await db.client().stock.findUnique({ where: { officeId_itemId: { officeId, itemId } } });
  return row?.currentQty;
}

const day = new Date("2026-03-02T00:00:00Z");

describe("D1 through the bridge", () => {
  test("a batch commits every write and reports the rows each touched", async () => {
    const { officeId, itemId, userId } = await shelf();
    const rows = await db.commitBatch((batch) => [
      batch.consumptionEntry.createMany({ data: [1, 2].map(() => ({ officeId, userId, itemId, date: day, qty: 1 })) }),
      ...stockDeltaOps(batch, { officeId, itemId, delta: -2, reason: "SERVED", userId }),
    ]);
    assert.deepEqual(rows, [2, 1, 1]);
    assert.equal(await stockOf(officeId, itemId), 3);
  });

  test("a failed guard rolls back the writes before and after it", async () => {
    const { officeId, itemId, userId } = await shelf();
    await assert.rejects(
      db.commitBatch((batch) => [
        batch.consumptionEntry.createMany({ data: [{ officeId, userId, itemId, date: day, qty: 9 }] }),
        stockAtLeast(batch, officeId, itemId, 9),
        ...stockDeltaOps(batch, { officeId, itemId, delta: -9, reason: "SERVED", userId }),
      ]),
      (error) => error instanceof BatchConflictError && error.reason === "guard",
    );
    assert.equal(await db.client().consumptionEntry.count({ where: { officeId } }), 0);
    assert.equal(await db.client().stockMovement.count({ where: { officeId } }), 0);
    assert.equal(await stockOf(officeId, itemId), 5);
  });

  test("a unique key taken in between is a conflict, and nothing is written", async () => {
    const { officeId } = await shelf();
    await assert.rejects(
      db.commitBatch((batch) => [
        batch.item.createMany({ data: [{ officeId, name: "Zero" }] }),
        batch.item.createMany({ data: [{ officeId, name: "Maté" }] }),
      ]),
      (error) => error instanceof BatchConflictError && error.reason === "unique",
    );
    assert.equal(await db.client().item.count({ where: { officeId, name: "Zero" } }), 0);
  });

  test("a single statement's error reaches Prisma as D1's", async () => {
    const { officeId } = await shelf();
    await assert.rejects(db.client().item.create({ data: { officeId, name: "Maté" } }), /Unique constraint failed/);
  });

  test("values come back as through the binding: bytes, dates, booleans, nulls", async () => {
    const { officeId } = await shelf();
    const picture = new Uint8Array([0, 1, 127, 128, 255]);
    const created = await db.client().item.create({ data: { officeId, name: "Ginger", terminalImage: picture, active: false } });
    const read = await db.client().item.findUniqueOrThrow({ where: { id: created.id } });
    assert.deepEqual(Array.from(read.terminalImage ?? []), Array.from(picture));
    assert.equal(read.terminalPhoto, null);
    assert.equal(read.active, false);
    assert.equal(read.createdAt.getTime(), created.createdAt.getTime());
  });
});

describe("R2 and the Queue through the bridge", () => {
  test("a file is stored, described, streamed back and removed", async () => {
    const key = `items/${crypto.randomUUID()}/photo.webp`;
    const bytes = crypto.getRandomValues(new Uint8Array(200_000));
    await storage.put(key, bytes, { contentType: "image/webp" });
    assert.deepEqual(await storage.head(key), { contentType: "image/webp", size: bytes.length });
    const object = await storage.get(key);
    assert.ok(object);
    assert.equal(object.contentType, "image/webp");
    assert.deepEqual(await readBlobBytes(object), bytes);
    await storage.delete(key);
    assert.equal(await storage.get(key), null);
    assert.equal(await storage.head(key), null);
    await storage.delete(key);
  });

  test("a stored file must be the bytes that were signed", async () => {
    const key = `invoices/${crypto.randomUUID()}.pdf`;
    const url = new URL(BRIDGE_PREFIX + storageRoute(key, "application/pdf"), server.origin);
    const signed = new TextEncoder().encode("the invoice");
    const contentSha256 = await sha256Hex(signed);
    const headers = await signatureHeaders(server.secret, { method: "PUT", path: url.pathname + url.search, contentSha256 });
    const response = await fetch(url, { method: "PUT", headers, body: new TextEncoder().encode("another invoice") });
    assert.equal(response.headers.get(BridgeHeader.marker), "1");
    assert.ok(!response.ok, `HTTP ${response.status}`);
    assert.equal(await storage.head(key), null);
  });

  test("a job is accepted by the queue", async () => {
    const jobs = bridgeJobQueue(connectBridge(server.origin, server.secret));
    await assert.doesNotReject(jobs.enqueue({ name: "period-statements", payload: { periodId: "p1" } }));
  });
});

describe("authentication", () => {
  test("an unsigned request gets the app's 404, which does not say the bridge exists", async () => {
    const response = await fetch(new URL(`${BRIDGE_PREFIX}d1/query`, server.origin), { method: "POST", body: "{}" });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get(BridgeHeader.marker), null);
  });

  test("a client with another secret is told the bridge did not answer", async () => {
    const stranger = connectBridge(server.origin, `${server.secret}-other`);
    await assert.rejects(new RemoteD1Database(stranger).prepare("SELECT 1").all(), /did not answer POST d1/);
  });
});
