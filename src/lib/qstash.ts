import { Receiver } from "@upstash/qstash";

/**
 * Verify an incoming QStash request signature.
 *
 * In development: skips verification so you can test locally with:
 *   curl -X POST http://localhost:3000/api/cron/daily-request
 *   curl -X POST http://localhost:3000/api/cron/monthly-reimbursement
 *
 * In production: validates the Upstash signature header.
 */
export async function verifyQStashSignature(request: Request): Promise<boolean> {
  if (process.env.NODE_ENV === "development") return true;

  const signingKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (!signingKey || !nextSigningKey) return false;

  const receiver = new Receiver({ currentSigningKey: signingKey, nextSigningKey });
  const body = await request.clone().text();
  const signature = request.headers.get("upstash-signature") ?? "";

  return receiver.verify({ signature, body }).catch(() => false);
}

/**
 * Hands one task to QStash for delivery to our own API.
 *
 * Used to get slow work out of a cron's request: the cron stays a fast loop
 * that decides *what* has to happen, and each unit of work gets its own
 * invocation, its own time budget and QStash's retries. Returns false when
 * QStash is not configured — local development and any self-host without a
 * token — so the caller can fall back to doing the work inline rather than
 * silently dropping it.
 */
export async function enqueueTask(
  path: string,
  body: unknown,
): Promise<boolean> {
  const token = process.env.QSTASH_TOKEN;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!token || !appUrl) return false;

  const res = await fetch(
    `https://qstash.upstash.io/v2/publish/${appUrl}${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Three attempts, then it lands in the QStash DLQ where it can be seen.
        "Upstash-Retries": "3",
      },
      body: JSON.stringify(body),
    },
  );
  return res.ok;
}
