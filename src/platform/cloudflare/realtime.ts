import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Terminal } from "../../../realtime/src/terminal";
import { terminalRelay } from "../../../realtime/src/locate";
import { noRelay, type TerminalRelay } from "../ports/realtime";

/**
 * The relay Worker's Durable Objects (realtime/), bound with `script_name` in wrangler.jsonc and
 * called over RPC. Off while the binding or `REALTIME_URL` (the relay's public origin) is missing;
 * a call that fails (relay not deployed, not running locally) answers as if there were none, so
 * terminals and consoles fall back to polling the site.
 */
function relay(): { namespace: DurableObjectNamespace<Terminal>; origin: string } | null {
  const { env } = getCloudflareContext();
  const namespace = (env as { TERMINALS?: DurableObjectNamespace<Terminal> }).TERMINALS;
  const url = process.env.REALTIME_URL;
  const origin = url?.endsWith("/") ? url.slice(0, -1) : url;
  return namespace && origin ? { namespace, origin } : null;
}

async function orNone<T>(what: string, call: () => Promise<T>, none: T): Promise<T> {
  try {
    return await call();
  } catch (error) {
    console.warn(`[relay] ${what} failed, falling back to polling`, error);
    return none;
  }
}

export const durableObjectRelay: TerminalRelay = {
  terminalUrl() {
    const found = relay();
    return found && `${found.origin}/terminals/socket`;
  },

  async console(deviceId, userId) {
    const found = relay();
    if (!found) return null;
    return orNone(
      "console ticket",
      async () => ({
        url: `${found.origin}/terminals/${encodeURIComponent(deviceId)}/socket`,
        ticket: await terminalRelay(found.namespace, deviceId).ticket(userId),
      }),
      null,
    );
  },

  async command(deviceId, command, by) {
    const found = relay();
    if (!found) return null;
    return orNone("command", () => terminalRelay(found.namespace, deviceId).command(command, by), null);
  },

  async changed(deviceIds, at) {
    const found = relay();
    if (!found) return;
    const sent = await Promise.allSettled(deviceIds.map((id) => terminalRelay(found.namespace, id).changed(at)));
    const failed = sent.find((result) => result.status === "rejected");
    if (failed) console.warn("[relay] change notice failed", failed.reason);
  },

  async presence(deviceIds) {
    const found = relay();
    if (!found || deviceIds.length === 0) return found && new Map();
    const answers = await Promise.allSettled(deviceIds.map((id) => terminalRelay(found.namespace, id).presence()));
    // Not a word from the relay: as if there were none, the site's own records show instead.
    if (answers.every((answer) => answer.status === "rejected")) return noRelay.presence(deviceIds);
    return new Map(
      answers.flatMap((answer, i) => (answer.status === "fulfilled" ? [[deviceIds[i], answer.value] as const] : [])),
    );
  },

  async screen(deviceId) {
    const found = relay();
    if (!found) return undefined;
    return orNone("screen", () => terminalRelay(found.namespace, deviceId).screen(), undefined);
  },
};
