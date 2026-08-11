import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandler,
} from "mcp-handler";
import { getBaseUrl, getMcpResourceUrl } from "@/lib/base-url";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) — tells an MCP client which
 * authorization server guards `/api/mcp`. The 401 from the MCP endpoint points
 * here via its `WWW-Authenticate: resource_metadata=...` challenge.
 *
 * `authServerUrls` must equal the `issuer` published by the authorization
 * server metadata, which for MateCrew is the bare origin.
 *
 * The optional catch-all covers both the bare path and the RFC 9728
 * path-insertion form (`/.well-known/oauth-protected-resource/api/mcp`).
 */
export const GET = protectedResourceHandler({
  authServerUrls: [getBaseUrl()],
  resourceUrl: getMcpResourceUrl(),
});

export const OPTIONS = metadataCorsOptionsRequestHandler();
