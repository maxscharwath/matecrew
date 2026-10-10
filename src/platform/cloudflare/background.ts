import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { RunInBackground } from "../ports/background";

/** Keeps the invocation alive until the task settles: workerd cancels floating promises once the response is sent. */
export const runInBackground: RunInBackground = (task, label) => {
  getCloudflareContext().ctx.waitUntil(
    task.catch((error: unknown) => console.error(`[background] ${label} failed`, error)),
  );
};
