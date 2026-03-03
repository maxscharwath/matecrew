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
