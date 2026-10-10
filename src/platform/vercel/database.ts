import type { Database } from "../ports/database";
import { connectD1, type D1Connection } from "../cloudflare/d1-database";
import type { Bridge } from "./bridge";
import { RemoteD1Database } from "./remote-d1";

/**
 * The Cloudflare deployment's D1 database, through the platform bridge, with
 * the same Prisma client and `commitBatch` as on Cloudflare.
 *
 * One connection for the process, unlike the Worker's one per request: those
 * exist because workerd ties I/O to the request that started it, which Node
 * does not. The connection holds no socket (each query is a fetch on Node's
 * keep-alive pool) and its batch compiler is serialised, so concurrent
 * requests share it safely and Prisma's query compiler loads once.
 */
export function bridgeDatabase(bridge: Bridge): Database {
  let connection: D1Connection | undefined;
  const current = () => {
    connection ??= connectD1(new RemoteD1Database(bridge));
    return connection;
  };
  return {
    client: () => current().client,
    commitBatch: (build) => current().commitBatch(build),
  };
}
