/**
 * The platform bridge's wire protocol, shared by the bridge (./handler.ts, in
 * the Worker) and its client (src/platform/vercel/bridge.ts). Web Crypto
 * only, so it runs on workerd, Node and Bun alike.
 *
 * Authentication: every request carries an HMAC-SHA256, under
 * PLATFORM_BRIDGE_SECRET, of its method, path with query, timestamp and the
 * SHA-256 of its body. The signature covers the claimed body hash, so it is
 * checked from the headers alone; the body is then checked against that hash
 * (by R2 itself for a stored file). A request more than MAX_CLOCK_SKEW_MS
 * away from the bridge's clock is refused, which bounds replays.
 */

/** Every bridge route starts with this; the rest of the app never uses it. */
export const BRIDGE_PREFIX = "/__platform/";

export const BridgeHeader = {
  /** Unix time of signing, in milliseconds. */
  timestamp: "x-bridge-timestamp",
  /** Hex SHA-256 of the body (of no bytes when there is none). */
  contentSha256: "x-bridge-content-sha256",
  /** Hex HMAC-SHA256 of the canonical request. */
  signature: "x-bridge-signature",
  /**
   * On every response the bridge sends. A refused request gets the app's
   * own 404 instead, so the client tells a refusal from a missing file.
   */
  marker: "x-bridge",
  /** A stored file's size in bytes, on GET and HEAD. */
  size: "x-bridge-size",
} as const;

export const BridgeRoute = {
  /** One statement: `QueryRequest`, replies with what D1 resolved to. */
  query: "d1/query",
  /** Statements run as one D1 batch (one transaction): `BatchRequest`, replies `D1Result[]`. */
  batch: "d1/batch",
  /** A script through `D1Database.exec`: `ExecRequest`, replies `D1ExecResult`. */
  exec: "d1/exec",
  /** A job for the Queue: the `Job` itself, replies 204. */
  jobs: "jobs",
  /** `storage/<encoded key>`: GET, HEAD, PUT (`?contentType=`) and DELETE on R2. */
  storage: "storage/",
} as const;

/** How far a request's timestamp may be from the bridge's clock, either way. */
export const MAX_CLOCK_SKEW_MS = 60_000;

/** A shorter secret disables the bridge (and the client refuses it). */
export const MIN_SECRET_LENGTH = 32;

/** Status of a statement D1 rejected; the body is `ErrorReply` with D1's message. */
export const D1_ERROR_STATUS = 422;

/** SHA-256 of no bytes: the content hash of a request without a body. */
export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export type QueryMode = "all" | "run" | "raw";

/** A statement and its values, already encoded as D1 binds them. */
export interface WireStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export interface QueryRequest extends WireStatement {
  readonly mode: QueryMode;
  /** With `raw`: put the column names first, as `raw({ columnNames: true })` does. */
  readonly columnNames?: boolean;
}

export interface BatchRequest {
  readonly statements: readonly WireStatement[];
}

export interface ExecRequest {
  readonly sql: string;
}

export interface ErrorReply {
  readonly error: string;
}

/** What a signature covers. */
export interface SignedRequest {
  readonly method: string;
  /** Path and query string, as `URL.pathname + URL.search` gives them. */
  readonly path: string;
  readonly contentSha256: string;
}

/** The route of a stored file; the key is one encoded path segment, so it is kept exactly. */
export function storageRoute(key: string, contentType?: string): string {
  const query = contentType === undefined ? "" : `?contentType=${encodeURIComponent(contentType)}`;
  return `${BridgeRoute.storage}${encodeURIComponent(key)}${query}`;
}

const encoder = new TextEncoder();
const HEX_DIGEST = /^[\da-f]{64}$/;

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer> | ArrayBuffer): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

let cachedKey: { readonly secret: string; readonly key: CryptoKey } | undefined;

/** The secret's HMAC key, imported once per secret. */
async function hmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKey?.secret !== secret) {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
    cachedKey = { secret, key };
  }
  return cachedKey.key;
}

function canonical(request: SignedRequest, timestamp: string): Uint8Array<ArrayBuffer> {
  return encoder.encode([request.method.toUpperCase(), request.path, timestamp, request.contentSha256].join("\n"));
}

/** The headers that authenticate `request`, signed at `now`. */
export async function signatureHeaders(
  secret: string,
  request: SignedRequest,
  now = Date.now(),
): Promise<Record<string, string>> {
  const timestamp = String(now);
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), canonical(request, timestamp));
  return {
    [BridgeHeader.timestamp]: timestamp,
    [BridgeHeader.contentSha256]: request.contentSha256,
    [BridgeHeader.signature]: toHex(signature),
  };
}

/**
 * The body hash the request's signature vouches for, or null when the
 * signature is missing, malformed, stale, or not made with `secret` for this
 * method and path. Reads headers only: the body is still unread afterwards.
 */
export async function verifiedContentHash(
  secret: string,
  request: Pick<Request, "method" | "url" | "headers">,
  now = Date.now(),
): Promise<string | null> {
  const timestamp = request.headers.get(BridgeHeader.timestamp) ?? "";
  const contentSha256 = request.headers.get(BridgeHeader.contentSha256) ?? "";
  const signature = request.headers.get(BridgeHeader.signature) ?? "";
  const signedAt = Number(timestamp);
  if (!/^\d{1,16}$/.test(timestamp) || Math.abs(now - signedAt) > MAX_CLOCK_SKEW_MS) return null;
  if (!HEX_DIGEST.test(contentSha256) || !HEX_DIGEST.test(signature)) return null;
  const url = new URL(request.url);
  const signed = canonical({ method: request.method, path: url.pathname + url.search, contentSha256 }, timestamp);
  // `verify` recomputes the MAC and compares it in constant time.
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromHex(signature), signed);
  return valid ? contentSha256 : null;
}
