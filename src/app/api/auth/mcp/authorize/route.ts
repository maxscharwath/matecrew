import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * OAuth authorization endpoint — Better Auth's `/mcp/authorize`, fronted by a
 * shim that makes loopback redirect URIs port-agnostic (RFC 8252 §7.3).
 *
 * Better Auth matches `redirect_uri` against the registered list byte-for-byte
 * (`plugins/mcp/authorize.mjs`), which native MCP clients routinely fail: they
 * register `http://127.0.0.1:<port>/callback` once and then bind whatever port
 * the OS hands them, or register one loopback spelling and authorize with the
 * other. The spec anticipates exactly this and requires an authorization
 * server to treat the port of a loopback redirect URI as variable.
 *
 * So before Better Auth sees the request, we reconcile the stored list: if the
 * requested URI is an http loopback URI whose path is already registered for
 * this client, that entry is rewritten to the requested port. Nothing else is
 * touched — a non-loopback URI, or a path that was never registered, still
 * fails the match, so this widens ports rather than accepting new callbacks.
 *
 * Being the more specific route, this file takes precedence over the
 * `[...all]` catch-all; both hand off to the same `auth.handler`.
 */

// Prisma needs Node APIs, so this cannot run on the edge.
export const runtime = "nodejs";

/** Hosts RFC 8252 §7.3 treats as loopback. `URL` keeps IPv6 in brackets. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Identity of a loopback callback ignoring its port: everything a client keeps
 * stable between registration and authorization. Returns null for anything
 * that is not an http loopback URI, which is what leaves it alone.
 */
function loopbackPath(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  if (!LOOPBACK_HOSTS.has(url.host.replace(/:\d+$/, ""))) return null;
  return `${url.pathname}${url.search}`;
}

async function allowLoopbackPort(request: Request): Promise<void> {
  const params = new URL(request.url).searchParams;
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  if (!clientId || !redirectUri) return;

  const path = loopbackPath(redirectUri);
  if (!path) return;

  const client = await prisma.oauthApplication.findUnique({
    where: { clientId },
    select: { id: true, redirectUrls: true },
  });
  if (!client) return;

  const registered = client.redirectUrls.split(",");
  if (registered.includes(redirectUri)) return;

  // Only a client that registered this very callback path gets the port
  // widened; otherwise the requested URI is simply not one of its callbacks.
  if (!registered.some((url) => loopbackPath(url) === path)) return;

  // Replace rather than append, so a client cycling through ephemeral ports
  // cannot grow the row without bound.
  const updated = [
    ...registered.filter((url) => loopbackPath(url) !== path),
    redirectUri,
  ];

  await prisma.oauthApplication.update({
    where: { id: client.id },
    data: { redirectUrls: updated.join(",") },
  });
}

export async function GET(request: Request): Promise<Response> {
  await allowLoopbackPort(request);
  return auth.handler(request);
}
