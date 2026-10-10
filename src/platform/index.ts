/**
 * The only entry point business code uses to reach the platform.
 *
 * `@/platform/active` is resolved at build time to src/platform/cloudflare,
 * src/platform/node or src/platform/vercel (the PLATFORM variable, see
 * next.config.ts), so a bundle never contains another platform's code. See
 * ./README.md.
 */
export type { Platform } from "./ports";
export type { RunInBackground } from "./ports/background";
export type {
  BatchBuilder,
  BatchClient,
  BatchConflictReason,
  BatchStep,
  Database,
  Db,
} from "./ports/database";
export { BatchConflictError, expectRows } from "./ports/database";
export type { AppEnv, EnvName } from "./ports/env";
export type { Job, JobHandlers, JobName, JobPayloads, JobQueue, ScheduledTask } from "./ports/jobs";
export type { BlobInfo, BlobObject, BlobStore } from "./ports/storage";
export { readBlobBytes } from "./ports/storage";
export { platform } from "@/platform/active";
