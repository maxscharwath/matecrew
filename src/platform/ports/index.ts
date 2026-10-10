import type { RunInBackground } from "./background";
import type { Database } from "./database";
import type { AppEnv } from "./env";
import type { ImageProcessor } from "./images";
import type { JobQueue } from "./jobs";
import type { PdfRenderer } from "./pdf";
import type { BlobStore } from "./storage";

/**
 * Everything the app needs from the platform it runs on. Each adapter set
 * (src/platform/cloudflare, src/platform/node, src/platform/vercel) exports one
 * `platform` object of this type, and the build picks one of them (see
 * src/platform/README.md).
 */
export interface Platform {
  readonly database: Database;
  readonly storage: BlobStore;
  readonly jobs: JobQueue;
  readonly runInBackground: RunInBackground;
  readonly env: AppEnv;
  readonly images: ImageProcessor;
  readonly pdf: PdfRenderer;
}
