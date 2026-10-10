import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { handleBridgeRequest, type BridgeEnv } from "../../src/platform/cloudflare/bridge/handler";
import {
  BRIDGE_PREFIX,
  BridgeHeader,
  D1_ERROR_STATUS,
  EMPTY_SHA256,
  sha256Hex,
  signatureHeaders,
  storageRoute,
} from "../../src/platform/cloudflare/bridge/protocol";

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const ORIGIN = "https://matecrew.example.workers.dev";
const encoder = new TextEncoder();

interface Seen {
  readonly prepared: { sql: string; params: unknown[] }[];
  readonly sent: unknown[];
}

/** Bindings that record what the bridge asks of them; a statement rejects when its SQL says so. `null`: no secret. */
function fakeEnv(secret: string | null = SECRET): { env: BridgeEnv; seen: Seen } {
  const seen: Seen = { prepared: [], sent: [] };
  const db = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => {
        seen.prepared.push({ sql, params });
        const result = async () => {
          if (sql.startsWith("FAIL")) throw new Error("D1_ERROR: UNIQUE constraint failed: Item.name: SQLITE_CONSTRAINT");
          return { success: true, meta: { changes: 1 }, results: [{ one: 1 }] };
        };
        return { all: result, run: result, raw: async () => [["one"], [1]] };
      },
    }),
    batch: (statements: { run: () => Promise<unknown> }[]) => Promise.all(statements.map((statement) => statement.run())),
  };
  const files = {
    get: async () => null,
    head: async (key: string) => ({ key, size: 3, httpMetadata: { contentType: "image/webp" } }),
  };
  const jobs = {
    send: async (body: unknown) => {
      seen.sent.push(body);
    },
  };
  const env = { DB: db, FILES: files, JOBS: jobs, PLATFORM_BRIDGE_SECRET: secret ?? undefined } as unknown as BridgeEnv;
  return { env, seen };
}

async function signed(method: string, route: string, body?: unknown, signedBody?: unknown): Promise<Request> {
  const bytes = body === undefined ? undefined : encoder.encode(JSON.stringify(body));
  const signedBytes = signedBody === undefined ? bytes : encoder.encode(JSON.stringify(signedBody));
  const url = new URL(BRIDGE_PREFIX + route, ORIGIN);
  const contentSha256 = signedBytes === undefined ? EMPTY_SHA256 : await sha256Hex(signedBytes);
  const headers = await signatureHeaders(SECRET, { method, path: url.pathname + url.search, contentSha256 });
  return new Request(url, { method, headers, body: bytes });
}

const query = { sql: "SELECT ?1 AS one", params: [1], mode: "all" };

describe("bridge handler", () => {
  test("leaves every other path to the app", async () => {
    const { env } = fakeEnv();
    assert.equal(await handleBridgeRequest(new Request(`${ORIGIN}/org/x`), env), null);
  });

  test("leaves an unsigned or wrongly signed request to the app, which answers 404 as for any unknown path", async () => {
    const { env, seen } = fakeEnv();
    assert.equal(await handleBridgeRequest(new Request(`${ORIGIN}${BRIDGE_PREFIX}d1/query`, { method: "POST", body: "{}" }), env), null);
    const request = await signed("POST", "d1/query", query);
    request.headers.set(BridgeHeader.signature, "0".repeat(64));
    assert.equal(await handleBridgeRequest(request, env), null);
    assert.deepEqual(seen.prepared, []);
  });

  test("is off without a secret, or with one too short", async () => {
    for (const secret of [null, "", "short"]) {
      const { env } = fakeEnv(secret);
      assert.equal(await handleBridgeRequest(await signed("POST", "d1/query", query), env), null, String(secret));
    }
  });

  test("runs a signed statement and marks its answer", async () => {
    const { env, seen } = fakeEnv();
    const response = await handleBridgeRequest(await signed("POST", "d1/query", query), env);
    assert.equal(response?.status, 200);
    assert.equal(response?.headers.get(BridgeHeader.marker), "1");
    assert.deepEqual(await response?.json(), { success: true, meta: { changes: 1 }, results: [{ one: 1 }] });
    assert.deepEqual(seen.prepared, [{ sql: "SELECT ?1 AS one", params: [1] }]);
  });

  test("refuses a body other than the one signed, before touching the database", async () => {
    const { env, seen } = fakeEnv();
    const response = await handleBridgeRequest(await signed("POST", "d1/query", { ...query, sql: "DELETE FROM User" }, query), env);
    assert.equal(response?.status, 400);
    assert.deepEqual(seen.prepared, []);
  });

  test("hands D1's error back with its message", async () => {
    const { env } = fakeEnv();
    const response = await handleBridgeRequest(await signed("POST", "d1/batch", { statements: [{ sql: "FAIL", params: [] }] }), env);
    assert.equal(response?.status, D1_ERROR_STATUS);
    assert.match(((await response?.json()) as { error: string }).error, /^D1_ERROR: UNIQUE constraint failed/);
  });

  test("rejects malformed requests", async () => {
    const { env } = fakeEnv();
    const missingMode = await handleBridgeRequest(await signed("POST", "d1/query", { sql: "SELECT 1", params: [] }), env);
    assert.equal(missingMode?.status, 400);
    const getQuery = await handleBridgeRequest(await signed("GET", "d1/query"), env);
    assert.equal(getQuery?.status, 405);
  });

  test("tells a missing file from a stored one", async () => {
    const { env } = fakeEnv();
    const missing = await handleBridgeRequest(await signed("GET", storageRoute("items/none.webp")), env);
    assert.equal(missing?.status, 404);
    assert.equal(missing?.headers.get(BridgeHeader.marker), "1");
    const head = await handleBridgeRequest(await signed("HEAD", storageRoute("items/a.webp")), env);
    assert.equal(head?.status, 200);
    assert.equal(head?.headers.get("content-type"), "image/webp");
    assert.equal(head?.headers.get(BridgeHeader.size), "3");
  });

  test("puts a job on the queue as JSON", async () => {
    const { env, seen } = fakeEnv();
    const job = { name: "period-statements", payload: { periodId: "p1" } };
    const response = await handleBridgeRequest(await signed("POST", "jobs", job), env);
    assert.equal(response?.status, 204);
    assert.deepEqual(seen.sent, [job]);
  });
});
