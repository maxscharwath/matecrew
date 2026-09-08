/**
 * Loopback redirect URIs, as native MCP clients actually use them.
 *
 * Two forces make a client's callback URI drift between the moment it
 * registers and the moment it is checked, and Better Auth compares the strings
 * byte-for-byte:
 *
 * - The port is not stable. RFC 8252 §7.3 requires an authorization server to
 *   treat the port of a loopback redirect URI as variable, precisely because a
 *   native app takes whatever port the OS gives it.
 * - The host spelling is not stable either. Vercel's edge rewrites `127.0.0.1`
 *   — any `127.x` — to `localhost` inside the `redirect_uri` query parameter,
 *   and only there; the same URI in a request body arrives untouched. So one
 *   client can present both spellings within a single flow.
 *
 * These helpers let the OAuth routes recognise "the same callback, spelled
 * differently" without loosening anything else: only http loopback URIs are
 * ever treated as equivalent, and only when their path and port agree.
 */

/** Hosts RFC 8252 §7.3 treats as loopback, plus what Vercel normalises them to. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface Loopback {
  /** Host without the port, as spelled — `127.0.0.1`, `localhost`, `[::1]`. */
  host: string;
  /** Port as spelled, empty when the URI carries none. */
  port: string;
  /** Path and query: what a client keeps stable across attempts. */
  path: string;
}

/** Splits an http loopback URI into its parts; null for anything else. */
export function parseLoopback(raw: string): Loopback | null {
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

export function formatLoopback(
  host: string,
  port: string,
  path: string,
): string {
  const authority = port ? `${host}:${port}` : host;
  return `http://${authority}${path}`;
}

/**
 * True when two URIs are the same loopback callback differing only in how the
 * host is spelled — same port, same path, both loopback.
 */
export function sameLoopbackCallback(a: string, b: string): boolean {
  const left = parseLoopback(a);
  const right = parseLoopback(b);
  if (!left || !right) return false;
  return left.port === right.port && left.path === right.path;
}
