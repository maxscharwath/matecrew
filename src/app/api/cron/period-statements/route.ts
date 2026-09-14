import { verifyQStashSignature } from "@/lib/qstash";
import { sendPeriodStatements } from "@/lib/settlement-mail";

// One office's statements per invocation: rendering and mailing a PDF per
// member is the slow part, and this is what the monthly cron fans out to.
export const maxDuration = 60;

/**
 * Mails one reimbursement period's statements — the task the monthly cron
 * queues, one message per office it closed.
 *
 * Safe to retry, which is why QStash is allowed to: every delivery is
 * recorded per recipient, so a second attempt picks up the people the first
 * never reached and leaves the rest alone.
 */
export async function POST(request: Request) {
  if (!(await verifyQStashSignature(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    periodId?: unknown;
    force?: unknown;
  } | null;
  const periodId = typeof body?.periodId === "string" ? body.periodId : null;
  if (!periodId) {
    return Response.json({ error: "periodId is required" }, { status: 400 });
  }

  const result = await sendPeriodStatements(periodId, {
    force: body?.force === true,
  });

  // A failed recipient is reported, not thrown: QStash would retry the whole
  // office, and the ones that did go out are already on record.
  return Response.json({ periodId, ...result });
}
