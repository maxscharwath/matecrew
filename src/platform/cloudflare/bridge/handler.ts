import {
  BRIDGE_PREFIX,
  BridgeHeader,
  BridgeRoute,
  D1_ERROR_STATUS,
  MIN_SECRET_LENGTH,
  sha256Hex,
  verifiedContentHash,
  type BatchRequest,
  type ExecRequest,
  type QueryRequest,
  type WireStatement,
} from "./protocol";

/**
 * The platform bridge: the Worker's D1, R2 and Queue bindings, over signed
 * HTTPS, for a deployment of the app outside Cloudflare (src/platform/vercel)
 * that shares their data. Bindings carry no API rate limit, unlike D1's REST
 * API, which shares the account's limit.
 *
 * PLATFORM_BRIDGE_SECRET grants full read and write access to the database
 * and the files: it is a database credential. Without it (or with one
 * shorter than MIN_SECRET_LENGTH) the bridge is off. A request it does not
 * authenticate is left to the app, which answers 404 as for any unknown path,
 * so the prefix does not advertise itself.
 *
 * Nothing here logs SQL values or bodies.
 */

export interface BridgeEnv {
  readonly DB: D1Database;
  readonly FILES: R2Bucket;
  readonly JOBS: Queue;
  readonly PLATFORM_BRIDGE_SECRET?: string;
}

const FALLBACK_CONTENT_TYPE = "application/octet-stream";

/** A response from the bridge itself, marked as such for the client. */
function reply(body: BodyInit | null, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...headers, [BridgeHeader.marker]: "1" } });
}

function json(value: unknown, status = 200): Response {
  return reply(JSON.stringify(value), status, { "content-type": "application/json" });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class BadRequest extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statement(value: unknown): WireStatement {
  if (!isRecord(value) || typeof value.sql !== "string" || !Array.isArray(value.params)) {
    throw new BadRequest("Expected a statement: { sql, params }");
  }
  return { sql: value.sql, params: value.params };
}

function bound(db: D1Database, { sql, params }: WireStatement): D1PreparedStatement {
  return db.prepare(sql).bind(...params);
}

/** The body as JSON, once it matches the hash the signature vouches for. */
async function signedJson(request: Request, contentSha256: string): Promise<unknown> {
  const body = await request.arrayBuffer();
  if ((await sha256Hex(body)) !== contentSha256) throw new BadRequest("The body does not match its signature");
  return JSON.parse(new TextDecoder().decode(body));
}

async function query(db: D1Database, body: unknown): Promise<unknown> {
  const prepared = bound(db, statement(body));
  const { mode, columnNames } = body as Partial<QueryRequest>;
  switch (mode) {
    case "all":
      return prepared.all();
    case "run":
      return prepared.run();
    case "raw":
      return columnNames === true ? prepared.raw({ columnNames: true }) : prepared.raw();
    default:
      throw new BadRequest("Expected mode all, run or raw");
  }
}

async function batch(db: D1Database, body: unknown): Promise<unknown> {
  const { statements } = (isRecord(body) ? body : {}) as Partial<BatchRequest>;
  if (!Array.isArray(statements)) throw new BadRequest("Expected { statements }");
  return db.batch(statements.map((entry) => bound(db, statement(entry))));
}

async function exec(db: D1Database, body: unknown): Promise<unknown> {
  const { sql } = (isRecord(body) ? body : {}) as Partial<ExecRequest>;
  if (typeof sql !== "string") throw new BadRequest("Expected { sql }");
  return db.exec(sql);
}

const D1_ROUTES: Record<string, (db: D1Database, body: unknown) => Promise<unknown>> = {
  [BridgeRoute.query]: query,
  [BridgeRoute.batch]: batch,
  [BridgeRoute.exec]: exec,
};

/** A D1 call: D1's own error comes back with D1_ERROR_STATUS and its message, which the client rethrows. */
async function d1(run: (db: D1Database, body: unknown) => Promise<unknown>, db: D1Database, body: unknown): Promise<Response> {
  let result: unknown;
  try {
    result = await run(db, body);
  } catch (error) {
    if (error instanceof BadRequest) throw error;
    return json({ error: messageOf(error) }, D1_ERROR_STATUS);
  }
  return json(result);
}

function infoHeaders(object: R2Object): Record<string, string> {
  return {
    "content-type": object.httpMetadata?.contentType ?? FALLBACK_CONTENT_TYPE,
    [BridgeHeader.size]: String(object.size),
  };
}

async function storage(request: Request, bucket: R2Bucket, url: URL, contentSha256: string): Promise<Response> {
  const key = decodeURIComponent(url.pathname.slice(BRIDGE_PREFIX.length + BridgeRoute.storage.length));
  if (key === "") throw new BadRequest("Expected a key");
  switch (request.method) {
    case "GET": {
      const object = await bucket.get(key);
      return object ? reply(object.body, 200, infoHeaders(object)) : reply(null, 404);
    }
    case "HEAD": {
      const object = await bucket.head(key);
      return object ? reply(null, 200, infoHeaders(object)) : reply(null, 404);
    }
    case "PUT": {
      const contentType = url.searchParams.get("contentType");
      if (!contentType) throw new BadRequest("Expected ?contentType=");
      // R2 checks the streamed body against the signed hash and stores nothing on a mismatch.
      await bucket.put(key, request.body ?? new Uint8Array(), { httpMetadata: { contentType }, sha256: contentSha256 });
      return reply(null, 204);
    }
    case "DELETE":
      await bucket.delete(key);
      return reply(null, 204);
    default:
      return reply(null, 405);
  }
}

async function route(request: Request, env: BridgeEnv, url: URL, contentSha256: string): Promise<Response> {
  const name = url.pathname.slice(BRIDGE_PREFIX.length);
  if (name.startsWith(BridgeRoute.storage)) return storage(request, env.FILES, url, contentSha256);
  if (request.method !== "POST") return reply(null, 405);
  const body = await signedJson(request, contentSha256);
  const d1Route = D1_ROUTES[name];
  if (d1Route) return d1(d1Route, env.DB, body);
  if (name === BridgeRoute.jobs) {
    if (!isRecord(body)) throw new BadRequest("Expected a job");
    await env.JOBS.send(body, { contentType: "json" });
    return reply(null, 204);
  }
  return reply(null, 404);
}

/**
 * Serves a bridge request; null when the request is not one, or is not
 * authenticated, so that the app answers it as it would any other path.
 */
export async function handleBridgeRequest(request: Request, env: BridgeEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(BRIDGE_PREFIX)) return null;
  const secret = env.PLATFORM_BRIDGE_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  const contentSha256 = await verifiedContentHash(secret, request);
  if (contentSha256 === null) return null;
  try {
    return await route(request, env, url, contentSha256);
  } catch (error) {
    // Malformed JSON or key encoding, or a body that is not what was signed.
    if (error instanceof BadRequest || error instanceof SyntaxError || error instanceof URIError) {
      return json({ error: error.message }, 400);
    }
    console.error(`[bridge] ${request.method} ${url.pathname.split("/")[2]} failed: ${messageOf(error)}`);
    return json({ error: messageOf(error) }, 500);
  }
}
