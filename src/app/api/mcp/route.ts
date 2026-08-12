import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { auth } from "@/lib/auth";
import { getBaseUrl } from "@/lib/base-url";
import { MCP_INSTRUCTIONS, registerMateCrewTools } from "@/lib/mcp/server";

/**
 * MateCrew's MCP endpoint — the connector URL users paste into Claude Desktop or
 * claude.ai.
 *
 * Transport is stateless Streamable HTTP: every request builds its own server
 * instance and carries its own bearer token. That is the only model that works
 * on Vercel, where consecutive requests may land on different instances and
 * nothing survives in memory between them.
 *
 * Authorization: MateCrew is its own OAuth 2.1 authorization server (see the
 * `mcp` plugin in `@/lib/auth`). An unauthenticated call gets a 401 whose
 * `WWW-Authenticate` header points at the protected-resource metadata, which is
 * how a client discovers where to send the user to sign in.
 */

// Prisma needs Node APIs, so this cannot run on the edge.
export const runtime = "nodejs";
// A tool that walks several months of reimbursements can outrun the 10s default.
export const maxDuration = 60;

const handler = createMcpHandler(registerMateCrewTools, {
  serverInfo: { name: "matecrew", version: "1.0.0" },
  instructions: MCP_INSTRUCTIONS,
});

const authenticatedHandler = withMcpAuth(
  handler,
  async (req, bearerToken) => {
    if (!bearerToken) return undefined;

    // Better Auth validates the token against OauthAccessToken (existence,
    // expiry, client) and returns the granted scopes plus the user it was
    // minted for. Returning undefined makes withMcpAuth answer 401.
    const session = await auth.api.getMcpSession({ headers: req.headers });
    if (!session?.userId) return undefined;

    return {
      token: bearerToken,
      clientId: session.clientId,
      scopes: session.scopes ? session.scopes.split(" ").filter(Boolean) : [],
      expiresAt: Math.floor(
        new Date(session.accessTokenExpiresAt).getTime() / 1000,
      ),
      // The tools read the acting user from here; roles come from the
      // database per office, never from the token.
      extra: { userId: session.userId },
    };
  },
  {
    required: true,
    // RFC 9728 path-insertion form for the resource `<origin>/api/mcp`.
    resourceMetadataPath: "/.well-known/oauth-protected-resource/api/mcp",
    // Careful: here `resourceUrl` is the ORIGIN that `resourceMetadataPath` is
    // appended to — not the resource identifier (which is what the same-named
    // option means in `protectedResourceHandler`). Passing the /api/mcp URL
    // would advertise `/api/mcp/.well-known/...` and break discovery.
    resourceUrl: getBaseUrl(),
  },
);

/**
 * CORS for browser-based MCP clients.
 *
 * `mcp-handler` applies CORS to its metadata handlers but not to the MCP
 * endpoint itself, which makes this route unreachable from a browser: Claude
 * Code connects server-side and never notices, while the Claude web app is
 * blocked before the request is even sent.
 *
 * `Access-Control-Expose-Headers` matters as much as the rest — without
 * `WWW-Authenticate` exposed, browser JavaScript cannot read the 401 challenge
 * and so cannot discover which authorization server to send the user to. The
 * connection fails looking like an unreachable server rather than a sign-in.
 *
 * `*` is safe here because the endpoint authenticates with a bearer token
 * rather than cookies: a hostile page gains nothing without a valid token, and
 * a wildcard origin cannot be combined with credentialed requests anyway.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "Access-Control-Expose-Headers":
    "WWW-Authenticate, mcp-session-id, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
};

function withCors(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const response = await handler(req);
    // Copy onto a mutable clone: the handler may return an immutable Response,
    // and a streamed body must be passed through untouched.
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      headers.set(key, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

const handlerWithCors = withCors(authenticatedHandler);

/** Preflight — must succeed before a browser will send the real request. */
export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export {
  handlerWithCors as GET,
  handlerWithCors as POST,
  handlerWithCors as DELETE,
};
