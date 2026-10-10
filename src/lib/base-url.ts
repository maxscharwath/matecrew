import { platform } from "@/platform";

/**
 * The app's public origin, with no trailing slash: BETTER_AUTH_URL, else
 * NEXT_PUBLIC_APP_URL, else the local dev server.
 *
 * This doubles as the OAuth `issuer` advertised to MCP clients, so it has to
 * be an explicit value rather than something inferred per-request: the issuer
 * in `/.well-known/oauth-authorization-server` must match byte-for-byte across
 * discovery, authorization and token calls or clients reject the flow.
 */
export function getBaseUrl(): string {
  return platform.env.baseUrl();
}

/** Absolute URL of the MCP endpoint — the OAuth protected resource. */
export function getMcpResourceUrl(): string {
  return `${getBaseUrl()}/api/mcp`;
}
