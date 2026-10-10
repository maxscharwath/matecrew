import type { RunInBackground } from "../ports/background";

const pending = new Set<Promise<void>>();

/** A long-lived Node process keeps running after the response, so tracking the promise is enough. */
export const runInBackground: RunInBackground = (task, label) => {
  const tracked: Promise<void> = task
    .then(
      () => undefined,
      (error: unknown) => console.error(`[background] ${label} failed`, error),
    )
    .finally(() => pending.delete(tracked));
  pending.add(tracked);
};

/** Resolves once every background task started so far has settled: for tests and graceful shutdown. */
export async function settleBackground(): Promise<void> {
  await Promise.all(pending);
}
