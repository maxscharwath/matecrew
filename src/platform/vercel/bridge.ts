import {
  BRIDGE_PREFIX,
  BridgeHeader,
  D1_ERROR_STATUS,
  EMPTY_SHA256,
  MIN_SECRET_LENGTH,
  sha256Hex,
  signatureHeaders,
  type ErrorReply,
} from "../cloudflare/bridge/protocol";
import type { AppEnv } from "../ports/env";

export type BridgeMethod = "GET" | "HEAD" | "PUT" | "DELETE" | "POST";

/**
 * The client of the Cloudflare Worker's platform bridge
 * (src/platform/cloudflare/bridge): signed HTTPS calls that the Worker runs
 * against its D1, R2 and Queue bindings.
 */
export interface Bridge {
  /**
   * Sends a signed request and resolves to the bridge's answer, whatever its
   * status. Throws when the bridge did not answer it (refused or unreachable),
   * so an outage never reads as a missing file.
   */
  send(method: BridgeMethod, route: string, body?: Uint8Array<ArrayBuffer>): Promise<Response>;
  /**
   * POSTs `payload` as JSON and resolves to the JSON reply (undefined for an
   * empty one). A statement D1 rejected throws an Error with D1's own message,
   * as the binding would.
   */
  call<T>(route: string, payload: unknown): Promise<T>;
}

const encoder = new TextEncoder();

/** The route's first segment, enough to say what failed without logging a key. */
function routeKind(route: string): string {
  return route.split("/")[0];
}

/** A bridge at `origin` (the Worker's URL), authenticated with `secret` (PLATFORM_BRIDGE_SECRET). */
export function connectBridge(origin: string, secret: string, fetcher: typeof fetch = fetch): Bridge {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`PLATFORM_BRIDGE_SECRET must be at least ${MIN_SECRET_LENGTH} characters long`);
  }

  async function send(method: BridgeMethod, route: string, body?: Uint8Array<ArrayBuffer>): Promise<Response> {
    const url = new URL(BRIDGE_PREFIX + route, origin);
    const contentSha256 = body === undefined ? EMPTY_SHA256 : await sha256Hex(body);
    const headers = await signatureHeaders(secret, { method, path: url.pathname + url.search, contentSha256 });
    // Node's fetch keeps the connection alive between calls. `no-store` keeps
    // Next's data cache out of the way; a redirect would lose the signature.
    const response = await fetcher(url, { method, headers, body, cache: "no-store", redirect: "error" });
    if (!response.headers.has(BridgeHeader.marker)) {
      await response.body?.cancel();
      throw new Error(
        `The platform bridge did not answer ${method} ${routeKind(route)} (HTTP ${response.status}): ` +
          "check PLATFORM_BRIDGE_URL, PLATFORM_BRIDGE_SECRET on both sides, and the clocks",
      );
    }
    return response;
  }

  async function call<T>(route: string, payload: unknown): Promise<T> {
    const response = await send("POST", route, encoder.encode(JSON.stringify(payload)));
    const text = await response.text();
    const reply: unknown = text === "" ? undefined : JSON.parse(text);
    if (response.ok) return reply as T;
    const message = (reply as Partial<ErrorReply> | undefined)?.error ?? "no details";
    if (response.status === D1_ERROR_STATUS) throw new Error(message);
    throw new Error(`The platform bridge failed on ${routeKind(route)} (HTTP ${response.status}): ${message}`);
  }

  return { send, call };
}

/** The bridge configured by PLATFORM_BRIDGE_URL and PLATFORM_BRIDGE_SECRET, read on first use (not at build time). */
export function bridgeFromEnv(env: AppEnv): Bridge {
  let bridge: Bridge | undefined;
  const connected = () => {
    bridge ??= connectBridge(env.require("PLATFORM_BRIDGE_URL"), env.require("PLATFORM_BRIDGE_SECRET"));
    return bridge;
  };
  return {
    send: (method, route, body) => connected().send(method, route, body),
    call: (route, payload) => connected().call(route, payload),
  };
}
