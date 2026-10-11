/**
 * The terminals' realtime relay: one Durable Object per terminal (`Terminal`), reached at
 *
 *   GET /terminals/socket              WebSocket for a terminal, its `mcd_…` token in Authorization
 *                                      (the ESP32) or as a subprotocol (the site's virtual terminal)
 *   GET /terminals/:deviceId/socket    WebSocket for a console, with a one-time `mct_…` ticket as a
 *                                      subprotocol (`Terminal.ticket`, asked by the site over RPC)
 *
 * The site calls the Durable Object directly over RPC (a binding with `script_name`), so nothing
 * here is shared with it but the D1 database, where terminals are looked up by the SHA-256 of
 * their token, as the site does (src/lib/device/auth.ts).
 */
import { SUBPROTOCOL } from "./protocol";
import { terminalRelay } from "./locate";
import type { RelayEnv } from "./terminal";

export { Terminal } from "./terminal";

const CONSOLE = /^\/terminals\/([\w-]{1,64})\/socket$/;
const TOKEN = /^mcd_[\w-]{20,}$/;
const TICKET = /^mct_[\w-]{20,}$/;

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The terminal a token belongs to, or null. */
async function deviceOf(db: D1Database, token: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT "id" FROM "Device" WHERE "tokenHash" = ?1')
    .bind(await sha256Hex(token))
    .first<{ id: string }>();
  return row?.id ?? null;
}

function refuse(status: number): Response {
  return new Response(null, { status });
}

const relay = {
  async fetch(request: Request, env: RelayEnv): Promise<Response> {
    const url = new URL(request.url);
    const consoleRoute = CONSOLE.exec(url.pathname);
    if (url.pathname !== "/terminals/socket" && !consoleRoute) return refuse(404);
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return refuse(426);

    const offered = (request.headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .map((protocol) => protocol.trim())
      .filter(Boolean);
    const headers = new Headers(request.headers);
    // The 101 names the subprotocol only when the client asked for it, or browsers drop the socket.
    if (offered.includes(SUBPROTOCOL)) headers.set("x-subprotocol", SUBPROTOCOL);

    let deviceId: string;
    if (consoleRoute) {
      const ticket = offered.find((protocol) => TICKET.test(protocol));
      if (!ticket) return refuse(401);
      deviceId = consoleRoute[1];
      headers.set("x-role", "console");
      headers.set("x-ticket", ticket);
    } else {
      const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
      const token = [bearer, ...offered].find((candidate) => candidate && TOKEN.test(candidate));
      const found = token ? await deviceOf(env.DB, token) : null;
      // 401: the token is not (or no longer) linked; the terminal checks with the site.
      if (!found) return refuse(401);
      deviceId = found;
      headers.set("x-role", "device");
    }
    headers.delete("authorization");
    return terminalRelay(env.TERMINALS, deviceId).fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<RelayEnv>;

export default relay;
