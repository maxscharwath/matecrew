import { prisma } from "@/lib/prisma";
import { isSessionOpen } from "@/lib/session-utils";

export type RequestResult =
  | { kind: "created" }
  | { kind: "already_registered" }
  | { kind: "closed"; cutoffTime: string }
  | { kind: "session_not_found" }
  | { kind: "not_member" };

export type CancelResult =
  | { kind: "cancelled" }
  | { kind: "not_registered" }
  | { kind: "served" }
  | { kind: "closed"; cutoffTime: string }
  | { kind: "session_not_found" }
  | { kind: "not_member" };

async function validateContext(opts: {
  userId: string;
  officeId: string;
  mateSessionId: string | null;
}): Promise<
  | { ok: true; session: { cutoffTime: string; timezone: string } | null }
  | { ok: false; reason: Exclude<RequestResult, { kind: "created" } | { kind: "already_registered" }> }
> {
  const membership = await prisma.membership.findUnique({
    where: { userId_officeId: { userId: opts.userId, officeId: opts.officeId } },
    select: { id: true },
  });
  if (!membership) return { ok: false, reason: { kind: "not_member" } };

  if (!opts.mateSessionId) return { ok: true, session: null };

  const mateSession = await prisma.mateSession.findUnique({
    where: { id: opts.mateSessionId },
    include: { office: { select: { timezone: true } } },
  });
  if (mateSession?.officeId !== opts.officeId) {
    return { ok: false, reason: { kind: "session_not_found" } };
  }
  if (!isSessionOpen(mateSession, mateSession.office.timezone)) {
    return {
      ok: false,
      reason: { kind: "closed", cutoffTime: mateSession.cutoffTime },
    };
  }
  return {
    ok: true,
    session: {
      cutoffTime: mateSession.cutoffTime,
      timezone: mateSession.office.timezone,
    },
  };
}

/**
 * Registers a maté request (idempotent). Shared by the webapp server action
 * and the Slack interaction handler.
 */
export async function createMateRequest(opts: {
  userId: string;
  officeId: string;
  mateSessionId: string | null;
  date: Date;
}): Promise<RequestResult> {
  const validation = await validateContext(opts);
  if (!validation.ok) return validation.reason;

  const existing = await prisma.dailyRequest.findFirst({
    where: {
      date: opts.date,
      officeId: opts.officeId,
      userId: opts.userId,
      mateSessionId: opts.mateSessionId,
    },
    select: { id: true },
  });
  if (existing) return { kind: "already_registered" };

  await prisma.dailyRequest.create({
    data: {
      date: opts.date,
      officeId: opts.officeId,
      userId: opts.userId,
      mateSessionId: opts.mateSessionId,
      status: "REQUESTED",
    },
  });
  return { kind: "created" };
}

/**
 * Cancels a maté request (idempotent). Refuses once served.
 */
export async function cancelMateRequest(opts: {
  userId: string;
  officeId: string;
  mateSessionId: string | null;
  date: Date;
}): Promise<CancelResult> {
  const validation = await validateContext(opts);
  if (!validation.ok) return validation.reason;

  const existing = await prisma.dailyRequest.findFirst({
    where: {
      date: opts.date,
      officeId: opts.officeId,
      userId: opts.userId,
      mateSessionId: opts.mateSessionId,
    },
    select: { id: true, status: true },
  });
  if (!existing) return { kind: "not_registered" };
  if (existing.status === "SERVED") return { kind: "served" };

  await prisma.dailyRequest.delete({ where: { id: existing.id } });
  return { kind: "cancelled" };
}

/**
 * Names of users who requested a maté for a given session/date, creation order.
 */
export async function listRequesterNames(opts: {
  officeId: string;
  mateSessionId: string | null;
  date: Date;
}): Promise<string[]> {
  const rows = await prisma.dailyRequest.findMany({
    where: {
      date: opts.date,
      officeId: opts.officeId,
      mateSessionId: opts.mateSessionId,
    },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.user.name);
}
