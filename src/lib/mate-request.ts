import { prisma } from "@/lib/prisma";
import { isSessionOpen } from "@/lib/session-utils";
import { resolveItemId } from "@/lib/items";

export type RequestResult =
  | { kind: "created" }
  | { kind: "already_registered" }
  | { kind: "closed"; cutoffTime: string }
  | { kind: "session_not_found" }
  | { kind: "item_not_found" }
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
  | {
      ok: false;
      reason: Exclude<
        RequestResult,
        { kind: "created" } | { kind: "already_registered" } | { kind: "item_not_found" }
      >;
    }
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
  itemId?: string | null;
}): Promise<RequestResult> {
  const validation = await validateContext(opts);
  if (!validation.ok) return validation.reason;

  const itemId = await resolveItemId(opts.officeId, opts.itemId);
  if (!itemId) return { kind: "item_not_found" };

  const existing = await prisma.dailyRequest.findFirst({
    where: {
      date: opts.date,
      officeId: opts.officeId,
      userId: opts.userId,
      mateSessionId: opts.mateSessionId,
    },
    select: { id: true, itemId: true, status: true },
  });
  if (existing) {
    // Already registered for this session. Allow switching the chosen item
    // while it's still pending; otherwise it's a no-op.
    if (existing.status === "REQUESTED" && existing.itemId !== itemId) {
      await prisma.dailyRequest.update({
        where: { id: existing.id },
        data: { itemId },
      });
      return { kind: "created" };
    }
    return { kind: "already_registered" };
  }

  await prisma.dailyRequest.create({
    data: {
      date: opts.date,
      officeId: opts.officeId,
      userId: opts.userId,
      itemId,
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

export interface ItemRequesterGroup {
  itemId: string;
  itemName: string;
  names: string[];
}

/**
 * Requesters for a session/date grouped by the item they chose, ordered the
 * same way items are displayed (default first). Only groups with at least one
 * requester are returned. When `status` is given, filters to that status.
 */
export async function listRequestersByItem(opts: {
  officeId: string;
  mateSessionId: string | null;
  date: Date;
  status?: "REQUESTED" | "SERVED";
}): Promise<ItemRequesterGroup[]> {
  const rows = await prisma.dailyRequest.findMany({
    where: {
      date: opts.date,
      officeId: opts.officeId,
      mateSessionId: opts.mateSessionId,
      ...(opts.status ? { status: opts.status } : {}),
    },
    include: {
      user: { select: { name: true } },
      item: { select: { id: true, name: true, isDefault: true, sortOrder: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map<string, ItemRequesterGroup & { order: [boolean, number, string] }>();
  for (const r of rows) {
    let group = groups.get(r.itemId);
    if (!group) {
      group = {
        itemId: r.item.id,
        itemName: r.item.name,
        names: [],
        order: [!r.item.isDefault, r.item.sortOrder, r.item.name],
      };
      groups.set(r.itemId, group);
    }
    group.names.push(r.user.name);
  }

  return [...groups.values()]
    .sort((a, b) => {
      if (a.order[0] !== b.order[0]) return a.order[0] ? 1 : -1;
      if (a.order[1] !== b.order[1]) return a.order[1] - b.order[1];
      return a.order[2].localeCompare(b.order[2]);
    })
    .map(({ itemId, itemName, names }) => ({ itemId, itemName, names }));
}
