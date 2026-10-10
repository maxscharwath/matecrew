/**
 * Work that may finish after the response has been sent, such as a low-stock
 * Slack alert or removing a replaced file.
 *
 * Serverless platforms freeze or stop the instance once the response is out,
 * so a floating promise can be cut short silently. The adapter keeps the
 * instance alive until `task` settles (`ctx.waitUntil` on Cloudflare) or
 * tracks it in-process (Node). A rejection is logged under `label`, never
 * thrown back at the caller.
 */
export type RunInBackground = (task: Promise<unknown>, label: string) => void;
