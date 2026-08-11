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

export {
  authenticatedHandler as GET,
  authenticatedHandler as POST,
  authenticatedHandler as DELETE,
};
