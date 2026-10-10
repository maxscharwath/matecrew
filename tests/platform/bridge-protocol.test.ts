import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  BRIDGE_PREFIX,
  BridgeHeader,
  EMPTY_SHA256,
  MAX_CLOCK_SKEW_MS,
  sha256Hex,
  signatureHeaders,
  storageRoute,
  verifiedContentHash,
  type SignedRequest,
} from "../../src/platform/cloudflare/bridge/protocol";

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const ORIGIN = "https://matecrew.example.workers.dev";
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

async function signedRequest(
  signed: SignedRequest,
  options: { signedAt?: number; secret?: string; override?: Partial<SignedRequest> } = {},
): Promise<Request> {
  const headers = await signatureHeaders(options.secret ?? SECRET, signed, options.signedAt ?? NOW);
  const sent = { ...signed, ...options.override };
  return new Request(new URL(sent.path, ORIGIN), {
    method: sent.method,
    headers: { ...headers, [BridgeHeader.contentSha256]: sent.contentSha256 },
  });
}

const query: SignedRequest = { method: "POST", path: `${BRIDGE_PREFIX}d1/query`, contentSha256: EMPTY_SHA256 };

describe("bridge signature", () => {
  test("an untouched request verifies, and vouches for its body hash", async () => {
    const body = new TextEncoder().encode('{"sql":"SELECT 1","params":[],"mode":"all"}');
    const contentSha256 = await sha256Hex(body);
    const request = await signedRequest({ ...query, contentSha256 });
    assert.equal(await verifiedContentHash(SECRET, request, NOW), contentSha256);
  });

  test("the empty body hash is SHA-256 of no bytes", async () => {
    assert.equal(await sha256Hex(new Uint8Array()), EMPTY_SHA256);
  });

  test("a request is accepted up to the allowed clock skew either way, and refused past it", async () => {
    const request = await signedRequest(query);
    assert.ok(await verifiedContentHash(SECRET, request, NOW + MAX_CLOCK_SKEW_MS));
    assert.ok(await verifiedContentHash(SECRET, request, NOW - MAX_CLOCK_SKEW_MS));
    assert.equal(await verifiedContentHash(SECRET, request, NOW + MAX_CLOCK_SKEW_MS + 1), null, "expired");
    assert.equal(await verifiedContentHash(SECRET, request, NOW - MAX_CLOCK_SKEW_MS - 1), null, "from the future");
  });

  test("changing the method, path, query or body hash breaks the signature", async () => {
    const storagePath = `${BRIDGE_PREFIX}${storageRoute("items/a/photo.webp", "image/webp")}`;
    const put: SignedRequest = { method: "PUT", path: storagePath, contentSha256: EMPTY_SHA256 };
    const tampered: Partial<SignedRequest>[] = [
      { method: "DELETE" },
      { path: `${BRIDGE_PREFIX}${storageRoute("items/b/photo.webp", "image/webp")}` },
      { path: `${BRIDGE_PREFIX}${storageRoute("items/a/photo.webp", "text/html")}` },
      { contentSha256: await sha256Hex(new TextEncoder().encode("other bytes")) },
    ];
    for (const override of tampered) {
      assert.equal(await verifiedContentHash(SECRET, await signedRequest(put, { override }), NOW), null, JSON.stringify(override));
    }
  });

  test("a signature made with another secret, or altered, is refused", async () => {
    assert.equal(await verifiedContentHash(SECRET, await signedRequest(query, { secret: `${SECRET}x` }), NOW), null);
    const request = await signedRequest(query);
    const signature = request.headers.get(BridgeHeader.signature) ?? "";
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
    request.headers.set(BridgeHeader.signature, flipped);
    assert.equal(await verifiedContentHash(SECRET, request, NOW), null);
  });

  test("a changed timestamp breaks the signature even inside the allowed skew", async () => {
    const request = await signedRequest(query);
    request.headers.set(BridgeHeader.timestamp, String(NOW + 1));
    assert.equal(await verifiedContentHash(SECRET, request, NOW), null);
  });

  test("missing or malformed headers are refused without verifying anything", async () => {
    const valid = await signedRequest(query);
    const cases: [string, string | null][] = [
      [BridgeHeader.signature, null],
      [BridgeHeader.timestamp, null],
      [BridgeHeader.contentSha256, null],
      [BridgeHeader.timestamp, "12.5"],
      [BridgeHeader.timestamp, "-1"],
      [BridgeHeader.signature, "not-hex"],
      [BridgeHeader.contentSha256, "ABC"],
    ];
    for (const [name, value] of cases) {
      const request = new Request(valid);
      if (value === null) request.headers.delete(name);
      else request.headers.set(name, value);
      assert.equal(await verifiedContentHash(SECRET, request, NOW), null, `${name}=${value}`);
    }
  });
});

describe("storage routes", () => {
  test("a key is one path segment, kept exactly through URL parsing", () => {
    for (const key of ["items/i1/7f3a-image.webp", "invoices/a b/ü+%.pdf", "firmware/../x.bin"]) {
      const url = new URL(BRIDGE_PREFIX + storageRoute(key), ORIGIN);
      const segment = url.pathname.slice(`${BRIDGE_PREFIX}storage/`.length);
      assert.ok(!segment.includes("/"), key);
      assert.equal(decodeURIComponent(segment), key);
    }
  });

  test("the content type travels in the signed query string", () => {
    const url = new URL(BRIDGE_PREFIX + storageRoute("avatars/u.webp", "image/webp"), ORIGIN);
    assert.equal(url.searchParams.get("contentType"), "image/webp");
  });
});
