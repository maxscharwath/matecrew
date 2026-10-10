import { after } from "next/server";
import type { RunInBackground } from "../ports/background";

/** Next's `after`, which keeps the Vercel function alive (`waitUntil`) until the task settles. */
export const runInBackground: RunInBackground = (task, label) => {
  after(task.catch((error: unknown) => console.error(`[background] ${label} failed`, error)));
};
