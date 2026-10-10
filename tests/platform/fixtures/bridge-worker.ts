/**
 * The platform bridge alone, mounted as src/platform/cloudflare/worker.ts
 * mounts it, with a plain 404 standing in for the app. Served by `wrangler
 * dev` on local D1, R2 and Queue bindings for tests/platform/support/bridge-server.ts.
 */
import { handleBridgeRequest, type BridgeEnv } from "../../../src/platform/cloudflare/bridge/handler";

export default {
  async fetch(request, env) {
    return (await handleBridgeRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<BridgeEnv>;
