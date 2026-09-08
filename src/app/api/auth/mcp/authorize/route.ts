import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * OAuth authorization endpoint — Better Auth's `/mcp/authorize`, fronted by a
 * shim that reconciles loopback redirect URIs with what the client registered.
 *
 * Two things conspire against a native MCP client here:
 *
 * 1. Better Auth compares `redirect_uri` byte-for-byte against the registered
 *    list (`plugins/mcp/authorize.mjs`), while RFC 8252 §7.3 requires the port
 *    of a loopback redirect URI to be treated as variable — a client that
 *    registers one port and then binds another is turned away.
 * 2. Vercel's edge rewrites `127.0.0.1` (any `127.x`, in fact) to `localhost`
 *    inside the `redirect_uri` query parameter. Only that parameter, and only
 *    in the query — the token request carries it in the body, untouched. So
 *    even a client that never changes ports authorizes as `localhost` and then
 *    exchanges its code as `127.0.0.1`, and Better Auth rejects the exchange.
 *
 * Both are fixed by settling on one spelling: the client's own. If the
 * requested URI is an http loopback URI whose path the client registered, it is
 * rewritten to the registered host spelling on the requested port, and the
 * stored entry is moved to that same value. Better Auth then matches, the
 * authorization code is bound to the spelling the client will send at the token
 * endpoint, and the browser is redirected to the port it is really listening
 * on. Non-loopback URIs and unregistered paths are left alone, so this
 * reconciles spelling and ports rather than accepting new callbacks.
 *
 * Being the more specific route, this file takes precedence over the
 * `[...all]` catch-all; both hand off to the same `auth.handler`.
 */

// Prisma needs Node APIs, so this cannot run on the edge.
export const runtime = "nodejs";

/** Hosts RFC 8252 §7.3 treats as loopback, plus what Vercel normalises them to. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

interface Loopback {
  /** Host without the port, as spelled — `127.0.0.1`, `localhost`, `[::1]`. */
  host: string;
  /** Port as spelled, empty when the URI carries none. */
  port: string;
  /** Path and query: what a client keeps stable across attempts. */
  path: string;
}

/** Splits an http loopback URI into its parts; null for anything else. */
function parseLoopback(raw: string): Loopback | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  const host = url.host.replace(/:\d+$/, "");
  if (!LOOPBACK_HOSTS.has(host)) return null;
  return { host, port: url.port, path: `${url.pathname}${url.search}` };
}

function formatLoopback(host: string, port: string, path: string): string {
  const authority = port ? `${host}:${port}` : host;
  return `http://${authority}${path}`;
}

/**
 * Returns the request Better Auth should see: the same one, unless its
 * `redirect_uri` needs reconciling with the client's registration.
 */
async function reconcileLoopback(request: Request): Promise<Request> {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  const requestedUri = url.searchParams.get("redirect_uri");
  if (!clientId || !requestedUri) return request;

  const requested = parseLoopback(requestedUri);
  if (!requested) return request;

  const client = await prisma.oauthApplication.findUnique({
    where: { clientId },
    select: { id: true, redirectUrls: true },
  });
  if (!client) return request;

  const registered = client.redirectUrls.split(",");
  const samePath = (uri: string) => parseLoopback(uri)?.path === requested.path;

  // Only a client that registered this very callback path gets reconciled;
  // otherwise the requested URI is simply not one of its callbacks.
  const match = registered.find(samePath);
  if (!match) return request;

  const target = formatLoopback(
    parseLoopback(match)!.host,
    requested.port,
    requested.path,
  );

  if (!registered.includes(target)) {
    // Move the entry rather than add one, so a client cycling through
    // ephemeral ports cannot grow the row without bound.
    await prisma.oauthApplication.update({
      where: { id: client.id },
      data: {
        redirectUrls: [
          ...registered.filter((uri) => !samePath(uri)),
          target,
        ].join(","),
      },
    });
  }

  if (target === requestedUri) return request;

  url.searchParams.set("redirect_uri", target);
  return new Request(url, request);
}

export async function GET(request: Request): Promise<Response> {
  return auth.handler(await reconcileLoopback(request));
}
