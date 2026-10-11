import type { Platform } from "../ports";
import { noRelay } from "../ports/realtime";
import { reactPdf } from "../node/pdf";
import { sharpImages } from "../node/images";
import { createProcessEnv } from "../shared/process-env";
import { runInBackground } from "./background";
import { bridgeFromEnv } from "./bridge";
import { bridgeDatabase } from "./database";
import { bridgeJobQueue } from "./jobs";
import { bridgeBlobStore } from "./storage";

const env = createProcessEnv();
const bridge = bridgeFromEnv(env);

/**
 * Vercel's Node runtime, sharing the Cloudflare deployment's data: D1, R2
 * and the Queue are reached through that Worker's platform bridge
 * (src/platform/cloudflare/bridge), and its Cron Triggers run every scheduled
 * task. Images and PDFs are rendered here, as on Node.
 */
export const platform: Platform = {
  database: bridgeDatabase(bridge),
  storage: bridgeBlobStore(bridge),
  jobs: bridgeJobQueue(bridge),
  runInBackground,
  env,
  images: sharpImages,
  pdf: reactPdf,
  // The relay's Durable Objects are reached through the Cloudflare Worker only: poll the site.
  relay: noRelay,
};
