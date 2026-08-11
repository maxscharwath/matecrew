import { oAuthDiscoveryMetadata } from "better-auth/plugins";
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
 */
export const GET = oAuthDiscoveryMetadata(auth);

// Browser-based MCP clients preflight the metadata fetch.
export const OPTIONS = metadataCorsOptionsRequestHandler();
