import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Database } from "../ports/database";
import { connectD1, type D1Connection } from "./d1-database";

/**
 * One connection per request (or cron run, or queue batch), keyed by its
 * execution context. A client shared by the whole isolate would let one
 * request's query be batched into another's I/O, which Workers cancels when
 * that other request ends; D1 holds no connection, so a client per request is
 * cheap.
 */
const connections = new WeakMap<object, D1Connection>();

function connection(): D1Connection {
  const { env, ctx } = getCloudflareContext();
  let current = connections.get(ctx);
  if (!current) {
    current = connectD1(env.DB);
    connections.set(ctx, current);
  }
  return current;
}

/** D1 through the Worker's `DB` binding. */
export const d1Database: Database = {
  client: () => connection().client,
  commitBatch: (build) => connection().commitBatch(build),
};
