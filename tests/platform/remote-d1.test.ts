import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { BridgeHeader, D1_ERROR_STATUS, verifiedContentHash } from "../../src/platform/cloudflare/bridge/protocol";
import { connectD1 } from "../../src/platform/cloudflare/d1-database";
import { BatchConflictError, expectRows } from "../../src/platform/ports/database";
import { connectBridge, type Bridge } from "../../src/platform/vercel/bridge";
import { RemoteD1Database } from "../../src/platform/vercel/remote-d1";

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const ORIGIN = "https://matecrew.example.workers.dev";

interface Call {
  readonly route: string;
  readonly payload: unknown;
}

/** A bridge that records each call and answers with `reply`. */
function fakeBridge(reply: (call: Call) => unknown): { bridge: Bridge; calls: Call[] } {
  const calls: Call[] = [];
  const bridge: Bridge = {
    send: () => Promise.reject(new Error("not used")),
    call: async <T>(route: string, payload: unknown) => {
      const call = { route, payload: JSON.parse(JSON.stringify(payload)) };
      calls.push(call);
      return reply(call) as T;
    },
  };
  return { bridge, calls };
}

const meta = { duration: 0.1, changes: 0, last_row_id: 0, changed_db: false, size_after: 0, rows_read: 1, rows_written: 0 };

describe("RemoteD1Database", () => {
  test("binds values as D1 does: bytes as arrays of byte values, the rest untouched", async () => {
    const { bridge, calls } = fakeBridge(() => ({ success: true, meta, results: [] }));
    const bytes = new Uint8Array([1, 2, 255]);
    await new RemoteD1Database(bridge)
      .prepare("INSERT INTO t VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind("text", 42, null, true, bytes, bytes.buffer)
      .run();
    assert.deepEqual(calls, [
      {
        route: "d1/query",
        payload: { sql: "INSERT INTO t VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params: ["text", 42, null, true, [1, 2, 255], [1, 2, 255]], mode: "run" },
      },
    ]);
  });

  test("refuses undefined, which D1 cannot bind either", () => {
    const { bridge } = fakeBridge(() => null);
    assert.throws(() => new RemoteD1Database(bridge).prepare("SELECT ?1").bind(undefined), /D1_TYPE_ERROR/);
  });

  test("bind returns a new statement, as D1 does", async () => {
    const { bridge, calls } = fakeBridge(() => ({ success: true, meta, results: [] }));
    const prepared = new RemoteD1Database(bridge).prepare("SELECT ?1");
    await prepared.bind(1).all();
    await prepared.bind(2).all();
    await prepared.all();
    assert.deepEqual(
      calls.map((call) => (call.payload as { params: unknown[] }).params),
      [[1], [2], []],
    );
  });

  test("all, run and raw resolve to D1's own result shapes", async () => {
    const result = { success: true, meta, results: [{ id: "a", qty: 2 }] };
    const raw = [["id", "qty"], ["a", 2]];
    const { bridge, calls } = fakeBridge((call) => ((call.payload as { mode: string }).mode === "raw" ? raw : result));
    const statement = new RemoteD1Database(bridge).prepare("SELECT id, qty FROM t");
    assert.deepEqual(await statement.all(), result);
    assert.deepEqual(await statement.run(), result);
    assert.deepEqual(await statement.raw({ columnNames: true }), raw);
    await statement.raw();
    assert.deepEqual(
      calls.map((call) => (call.payload as { columnNames?: boolean }).columnNames),
      [undefined, undefined, true, false],
    );
  });

  test("first gives the first row, one of its columns, or null; an unknown column throws as on D1", async () => {
    const rows = [{ id: "a", qty: 2 }, { id: "b", qty: 3 }];
    const { bridge } = fakeBridge((call) => ({ success: true, meta, results: (call.payload as { sql: string }).sql === "none" ? [] : rows }));
    const db = new RemoteD1Database(bridge);
    assert.deepEqual(await db.prepare("rows").first(), { id: "a", qty: 2 });
    assert.equal(await db.prepare("rows").first("qty"), 2);
    assert.equal(await db.prepare("none").first(), null);
    await assert.rejects(db.prepare("rows").first("missing"), /D1_COLUMN_NOTFOUND/);
  });

  test("batch sends its statements in order, and only statements it prepared", async () => {
    const { bridge, calls } = fakeBridge(() => [{ success: true, meta, results: [] }]);
    const db = new RemoteD1Database(bridge);
    await db.batch([db.prepare("A ?1").bind(1), db.prepare("B")]);
    assert.deepEqual(calls, [{ route: "d1/batch", payload: { statements: [{ sql: "A ?1", params: [1] }, { sql: "B", params: [] }] } }]);
    await assert.rejects(db.batch([{} as D1PreparedStatement]), TypeError);
  });

  test("exec goes to its own route", async () => {
    const { bridge, calls } = fakeBridge(() => ({ count: 1, duration: 0.2 }));
    assert.deepEqual(await new RemoteD1Database(bridge).exec("DELETE FROM t"), { count: 1, duration: 0.2 });
    assert.deepEqual(calls, [{ route: "d1/exec", payload: { sql: "DELETE FROM t" } }]);
  });
});

/** A fetch standing in for the Worker: checks each request's signature, then answers with `respond`. */
function workerFetch(respond: (route: string, body: string) => Response): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = await request.clone().text();
    assert.ok(await verifiedContentHash(SECRET, request), "the client signs what the bridge verifies");
    return respond(new URL(request.url).pathname.replace("/__platform/", ""), body);
  }) as typeof fetch;
}

function bridgeReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { [BridgeHeader.marker]: "1" } });
}

describe("bridge client", () => {
  test("refuses a secret too short to stand for a database credential", () => {
    assert.throws(() => connectBridge(ORIGIN, "short"), /at least 32 characters/);
  });

  test("an answer without the bridge's marker is a refusal, never a missing file", async () => {
    const bridge = connectBridge(ORIGIN, SECRET, workerFetch(() => new Response("Not found", { status: 404 })));
    await assert.rejects(bridge.send("GET", "storage/x"), /did not answer GET storage/);
  });

  test("a D1 error comes back with D1's message, so a failed guard is still a guard conflict", async () => {
    const bridge = connectBridge(
      ORIGIN,
      SECRET,
      workerFetch((route) =>
        route === "d1/batch"
          ? bridgeReply({ error: "D1_ERROR: malformed JSON: SQLITE_ERROR" }, D1_ERROR_STATUS)
          : bridgeReply({ error: "unexpected" }, 500),
      ),
    );
    const { commitBatch } = connectD1(new RemoteD1Database(bridge));
    await assert.rejects(
      commitBatch((db) => [expectRows(db.stock.updateMany({ where: { officeId: "o", itemId: "i" }, data: { currentQty: 1 } }), 1)]),
      (error) => error instanceof BatchConflictError && error.reason === "guard",
    );
  });

  test("a unique violation inside the batch is a unique conflict", async () => {
    const bridge = connectBridge(
      ORIGIN,
      SECRET,
      workerFetch(() => bridgeReply({ error: "D1_ERROR: UNIQUE constraint failed: Item.officeId, Item.name: SQLITE_CONSTRAINT" }, D1_ERROR_STATUS)),
    );
    const { commitBatch } = connectD1(new RemoteD1Database(bridge));
    await assert.rejects(
      commitBatch((db) => [db.item.createMany({ data: [{ officeId: "o", name: "Maté" }] })]),
      (error) => error instanceof BatchConflictError && error.reason === "unique",
    );
  });

  test("any other failure names the route, not the values", async () => {
    const bridge = connectBridge(ORIGIN, SECRET, workerFetch(() => bridgeReply({ error: "R2 down" }, 500)));
    await assert.rejects(bridge.call("jobs", { name: "period-statements", payload: { periodId: "p" } }), /failed on jobs \(HTTP 500\): R2 down/);
  });
});
