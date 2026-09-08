import { auth } from "@/lib/auth";
import { formatLoopback, parseLoopback } from "@/lib/mcp/loopback";
import { prisma } from "@/lib/prisma";

/**
 * OAuth authorization endpoint — Better Auth's `/mcp/authorize`, fronted by a
 * shim that reconciles a loopback `redirect_uri` with what the client
 * registered, so a native MCP client is not refused over a port or a host
 * spelling it does not control (see `@/lib/mcp/loopback` for both causes).
 *
 * A loopback URI whose path the client registered is rewritten to the
 * registered host spelling on the requested port: Better Auth's byte-for-byte
 * match then succeeds, the browser is redirected to the port the client is
 * really listening on, and the code is bound to a spelling the client
 * recognises. The stored entry moves to the same value, since that match is
 * against the registered list. Non-loopback URIs and unregistered paths are
 * left alone, so this reconciles spelling and ports rather than accepting new
 * callbacks — and `/mcp/token` forgives the spelling too, so a stale
 * registration cannot strand the exchange.
 *
 * Being the more specific route, this file takes precedence over the
 * `[...all]` catch-all; both hand off to the same `auth.handler`.
 */

// Prisma needs Node APIs, so this cannot run on the edge.
export const runtime = "nodejs";

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
