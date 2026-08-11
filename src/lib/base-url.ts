/**
 * The app's public origin, with no trailing slash.
 *
 * This doubles as the OAuth `issuer` advertised to MCP clients, so it has to
 * be an explicit value rather than something inferred per-request: the issuer
 * in `/.well-known/oauth-authorization-server` must match byte-for-byte across
 * discovery, authorization and token calls or clients reject the flow.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` is the last resort so preview deployments
 * still produce a usable issuer when the env vars aren't set.
 */
export function getBaseUrl(): string {
  const configured =
    process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost}`;

  return "http://localhost:3000";
}

/** Absolute URL of the MCP endpoint — the OAuth protected resource. */
export function getMcpResourceUrl(): string {
  return `${getBaseUrl()}/api/mcp`;
}
