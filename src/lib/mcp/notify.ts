/**
 * Runs a best-effort side effect (Slack alerts, emails) after a write has
 * already committed.
 *
 * The web app fires these without awaiting, but a serverless MCP handler can be
 * frozen the moment it returns its response, which would drop the notification.
 * So we await — and swallow, because the write is already durable and reporting
 * a failed alert as a failed tool call would tell the model to retry a mutation
 * that actually succeeded.
 */
export async function notifyQuietly(
  label: string,
  task: () => Promise<unknown>,
): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error(`[mcp] ${label} notification failed`, error);
  }
}
