import { getPlatformProxy } from "wrangler";
import { connectD1, type D1Connection } from "../../src/platform/cloudflare/d1-database";

/**
 * Runs `task` against the local D1 database: the one wrangler keeps under
 * .wrangler/state for `wrangler dev`, `bun run preview` and
 * `PLATFORM=cloudflare next dev`, with the migrations from
 * `bun db:migrate:local` applied. Never the remote database.
 */
export async function withLocalD1<T>(task: (db: D1Connection, raw: D1Database) => Promise<T>): Promise<T> {
  const proxy = await getPlatformProxy<CloudflareEnv>({ persist: true });
  try {
    return await task(connectD1(proxy.env.DB), proxy.env.DB);
  } finally {
    await proxy.dispose();
  }
}
