import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

/**
 * Every page that reads the session is rendered per request, and the app
 * uses no ISR or data cache: prerendered pages are served from the static
 * assets, and `revalidatePath` only refreshes the router payload. No cache
 * bucket, queue or tag cache to provision.
 */
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
