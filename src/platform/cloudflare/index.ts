import type { Platform } from "../ports";
import { createProcessEnv } from "../shared/process-env";
import { runInBackground } from "./background";
import { d1Database } from "./database";
import { cloudflareImages } from "./images";
import { cloudflareJobQueue } from "./jobs";
import { workerdReactPdf } from "./pdf";
import { r2BlobStore } from "./storage";

/**
 * Cloudflare Workers through OpenNext. Bindings are read per call from
 * `getCloudflareContext()`, which the Worker sets for every request, cron
 * run and queue batch (./worker.ts).
 */
export const platform: Platform = {
  database: d1Database,
  storage: r2BlobStore,
  jobs: cloudflareJobQueue,
  runInBackground,
  env: createProcessEnv(),
  images: cloudflareImages,
  pdf: workerdReactPdf,
};
