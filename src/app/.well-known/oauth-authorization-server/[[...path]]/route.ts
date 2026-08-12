import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { auth } from "@/lib/auth";

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 *
 * MateCrew's issuer is the bare origin, so the canonical document lives at
 * `/.well-known/oauth-authorization-server`. The optional catch-all also
 * answers the path-insertion variants some MCP clients probe first (e.g.
 * `/.well-known/oauth-authorization-server/api/mcp`) — every variant describes
 * the same single authorization server, so serving one body is correct.
 *
 * The document comes from Better Auth, then gets three corrections. It would be
 * tidier to pass these through `oidcConfig.metadata`, but the plugin calls its
 * metadata builder with the outer `mcp()` options, so that field is never read.
 */
export async function GET(): Promise<Response> {
  const metadata = await auth.api.getMcpOAuthConfig();

  const corrected: Record<string, unknown> = { ...metadata };

  // The plugin advertises these two but never registers a route for either, so
  // as published they are a 404 waiting to happen. Both are optional in
  // RFC 8414, and MCP clients authenticate with the opaque access token, so
  // dropping them is better than pointing at nothing.
  delete corrected.jwks_uri;
  delete corrected.userinfo_endpoint;

  // Without the JWT plugin, id_tokens are signed HS256 (symmetric) — not the
  // RS256 the plugin claims. A client that took RS256 at face value would look
  // for a public key that cannot exist.
  corrected.id_token_signing_alg_values_supported = ["HS256"];

  return Response.json(corrected, {
    headers: {
      // Browser-based clients read this cross-origin.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Cache-Control": "max-age=3600",
    },
  });
}

// Browser-based MCP clients preflight the metadata fetch.
export const OPTIONS = metadataCorsOptionsRequestHandler();
