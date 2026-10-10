/**
 * The terminals' realtime relay: one Durable Object per terminal (`Terminal`), reached at
 *
 *   GET  /terminals/:id/socket?token=…   WebSocket, for the terminal or a console
 *   POST /terminals/:id/commands          a command from the site (Bearer token, role "site")
 *
 * Every caller presents a short-lived token the site signed with `REALTIME_SECRET`
 * (`./token`), so the relay never needs the database.
 */
import { verify, type Role } from "./token";

export { Terminal } from "./terminal";

export type Env = {
  TERMINALS: DurableObjectNamespace;
  /** Shared with the site, which signs the tokens. */
  REALTIME_SECRET: string;
};

const ROUTE = /^\/terminals\/([A-Za-z0-9_-]{1,64})\/(socket|commands)$/;

const relay = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = ROUTE.exec(url.pathname);
    if (!route) return new Response(null, { status: 404 });
    const [, terminal, action] = route;

    const token =
      url.searchParams.get("token") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const claims = await verify(env.REALTIME_SECRET, token);
    const allowed: Record<string, Role[]> = { socket: ["device", "console"], commands: ["site"] };
    if (claims?.sub !== terminal || !allowed[action].includes(claims.role)) {
      return new Response(null, { status: 401 });
    }
    if (action === "socket" && request.headers.get("upgrade") !== "websocket") {
      return new Response("expected a WebSocket", { status: 426 });
    }

    const headers = new Headers(request.headers);
    headers.set("x-role", claims.role);
    const stub = env.TERMINALS.get(env.TERMINALS.idFromName(terminal));
    return stub.fetch(new Request(request, { headers }));
  },
};

export default relay;
