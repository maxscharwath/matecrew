import type { Platform } from "../ports";
import { noRelay } from "../ports/realtime";
import { createProcessEnv } from "../shared/process-env";
import { runInBackground } from "./background";
import { sqliteDatabase } from "./database";
import { sharpImages } from "./images";
import { inProcessJobQueue } from "./jobs";
import { reactPdf } from "./pdf";
import { createFileBlobStore } from "./storage";

/** Plain Node: `next dev`, `next start`, tests, and a container such as Azure App Service. */
export const platform: Platform = {
  database: sqliteDatabase,
  storage: createFileBlobStore(),
  jobs: inProcessJobQueue,
  runInBackground,
  env: createProcessEnv(),
  images: sharpImages,
  pdf: reactPdf,
  // No Durable Objects: terminals and consoles poll the site.
  relay: noRelay,
};
