/**
 * Account synchronization & merge engine.
 *
 * Detects duplicate `User` rows that belong to the same person across aliased
 * email domains (see `email-identity.ts`) and merges one account into another,
 * re-homing every related record so no consumption, reimbursement, membership
 * or Slack link is lost.
 */

import { prisma } from "@/lib/prisma";
import { canonicalEmailKey } from "@/lib/email-identity";
import type { Prisma } from "@/generated/prisma/client";

export interface DuplicateUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  slackUserId: string | null;
  emailVerified: boolean;
  createdAt: Date;
  counts: {
    memberships: number;
    dailyRequests: number;
    consumptionEntries: number;
    purchaseBatches: number;
    reimbursementLines: number;
    stockMovements: number;
    sessions: number;
    accounts: number;
  };
}

export interface DuplicateGroup {
  /** Canonical identity key shared by every user in the group. */
  key: string;
  users: DuplicateUser[];
}

export interface MergeSummary {
  targetUserId: string;
  sourceUserId: string;
}

/**
 * Scan all users and return the groups of two or more accounts that resolve to
 * the same canonical email identity. Groups (and the users within them) are
 * ordered oldest-first so the original account surfaces at the top.
 */
export async function findDuplicateAccountGroups(): Promise<DuplicateGroup[]> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      slackUserId: true,
      emailVerified: true,
      createdAt: true,
      _count: {
        select: {
          memberships: true,
          dailyRequests: true,
          consumptionEntries: true,
          orderedBatches: true,
          paidBatches: true,
          reimbursementsFrom: true,
          reimbursementsTo: true,
          stockMovements: true,
          sessions: true,
          accounts: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map<string, DuplicateUser[]>();
  for (const u of users) {
    const key = canonicalEmailKey(u.email);
    if (!key) continue;
    const entry: DuplicateUser = {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      slackUserId: u.slackUserId,
      emailVerified: u.emailVerified,
      createdAt: u.createdAt,
      counts: {
        memberships: u._count.memberships,
        dailyRequests: u._count.dailyRequests,
        consumptionEntries: u._count.consumptionEntries,
        purchaseBatches: u._count.orderedBatches + u._count.paidBatches,
        reimbursementLines:
          u._count.reimbursementsFrom + u._count.reimbursementsTo,
        stockMovements: u._count.stockMovements,
        sessions: u._count.sessions,
        accounts: u._count.accounts,
      },
    };
    const existing = groups.get(key);
    if (existing) existing.push(entry);
    else groups.set(key, [entry]);
  }

  return Array.from(groups.entries())
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, users: list }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Merge `sourceUserId` into `targetUserId`. The target is kept as the canonical
 * account; the source's records are re-homed onto the target and the source row
 * is deleted. Runs in a single transaction. Throws if the accounts don't exist,
 * are identical, or don't share the same canonical identity.
 */
export async function mergeAccounts(
  targetUserId: string,
  sourceUserId: string
): Promise<MergeSummary> {
  if (targetUserId === sourceUserId) {
    throw new Error("Cannot merge an account into itself.");
  }

  return prisma.$transaction(async (tx) => {
    const [target, source] = await Promise.all([
      tx.user.findUnique({
        where: { id: targetUserId },
        include: {
          memberships: true,
          joinRequests: true,
          accounts: { select: { providerId: true } },
        },
      }),
      tx.user.findUnique({
        where: { id: sourceUserId },
        include: { dailyRequests: true },
      }),
    ]);

    if (!target || !source) {
      throw new Error("One or both accounts no longer exist.");
    }

    const targetKey = canonicalEmailKey(target.email);
    const sourceKey = canonicalEmailKey(source.email);
    if (!targetKey || targetKey !== sourceKey) {
      throw new Error(
        "These accounts do not share the same email identity and cannot be merged."
      );
    }

    // ── Simple FK reassignments (no unique constraints to worry about) ──
    const reassign = { where: { userId: sourceUserId }, data: { userId: targetUserId } };
    await tx.consumptionEntry.updateMany(reassign);
    await tx.stockMovement.updateMany(reassign);
    await tx.session.updateMany(reassign);
    await tx.purchaseBatch.updateMany({
      where: { orderedByUserId: sourceUserId },
      data: { orderedByUserId: targetUserId },
    });
    await tx.purchaseBatch.updateMany({
      where: { paidByUserId: sourceUserId },
      data: { paidByUserId: targetUserId },
    });
    await tx.reimbursementLine.updateMany({
      where: { fromUserId: sourceUserId },
      data: { fromUserId: targetUserId },
    });
    await tx.reimbursementLine.updateMany({
      where: { toUserId: sourceUserId },
      data: { toUserId: targetUserId },
    });

    // ── Provider accounts: move only providers the target lacks; drop dupes ──
    const targetProviders = new Set(target.accounts.map((a) => a.providerId));
    const sourceAccounts = await tx.account.findMany({
      where: { userId: sourceUserId },
      select: { id: true, providerId: true },
    });
    for (const acc of sourceAccounts) {
      if (targetProviders.has(acc.providerId)) {
        await tx.account.delete({ where: { id: acc.id } });
      } else {
        await tx.account.update({
          where: { id: acc.id },
          data: { userId: targetUserId },
        });
        targetProviders.add(acc.providerId);
      }
    }

    // ── Memberships: unique [userId, officeId]; union roles on conflict ──
    const targetMembershipByOffice = new Map(
      target.memberships.map((m) => [m.officeId, m])
    );
    const sourceMemberships = await tx.membership.findMany({
      where: { userId: sourceUserId },
    });
    for (const m of sourceMemberships) {
      const existing = targetMembershipByOffice.get(m.officeId);
      if (existing) {
        const mergedRoles = Array.from(new Set([...existing.roles, ...m.roles]));
        await tx.membership.update({
          where: { id: existing.id },
          data: { roles: mergedRoles },
        });
        await tx.membership.delete({ where: { id: m.id } });
      } else {
        await tx.membership.update({
          where: { id: m.id },
          data: { userId: targetUserId },
        });
      }
    }

    // ── Join requests: unique [userId, officeId]; keep the target's ──
    const targetJoinOffices = new Set(target.joinRequests.map((j) => j.officeId));
    const sourceJoinRequests = await tx.joinRequest.findMany({
      where: { userId: sourceUserId },
    });
    for (const j of sourceJoinRequests) {
      if (targetJoinOffices.has(j.officeId)) {
        await tx.joinRequest.delete({ where: { id: j.id } });
      } else {
        await tx.joinRequest.update({
          where: { id: j.id },
          data: { userId: targetUserId },
        });
        targetJoinOffices.add(j.officeId);
      }
    }

    // ── Daily requests: unique [date, officeId, userId, mateSessionId] ──
    const targetDailyKeys = new Set(
      (
        await tx.dailyRequest.findMany({
          where: { userId: targetUserId },
          select: { date: true, officeId: true, mateSessionId: true },
        })
      ).map((d) => dailyRequestKey(d.date, d.officeId, d.mateSessionId))
    );
    for (const d of source.dailyRequests) {
      const key = dailyRequestKey(d.date, d.officeId, d.mateSessionId);
      if (targetDailyKeys.has(key)) {
        await tx.dailyRequest.delete({ where: { id: d.id } });
      } else {
        await tx.dailyRequest.update({
          where: { id: d.id },
          data: { userId: targetUserId },
        });
        targetDailyKeys.add(key);
      }
    }

    // ── Scalar fields: fill gaps on the target, then free the source's ──
    // Release the source's unique slackUserId before re-assigning it.
    await tx.user.update({
      where: { id: sourceUserId },
      data: { slackUserId: null },
    });

    const targetPatch: Prisma.UserUpdateInput = {};
    if (!target.slackUserId && source.slackUserId) {
      targetPatch.slackUserId = source.slackUserId;
    }
    if (!target.image && source.image) {
      targetPatch.image = source.image;
    }
    if (!target.defaultOfficeId && source.defaultOfficeId) {
      targetPatch.defaultOffice = { connect: { id: source.defaultOfficeId } };
    }
    if (!target.emailVerified && source.emailVerified) {
      targetPatch.emailVerified = true;
    }
    if (Object.keys(targetPatch).length > 0) {
      await tx.user.update({ where: { id: targetUserId }, data: targetPatch });
    }

    // ── Remove the now-empty source account ──
    await tx.user.delete({ where: { id: sourceUserId } });

    return { targetUserId, sourceUserId };
  });
}

function dailyRequestKey(
  date: Date,
  officeId: string,
  mateSessionId: string | null
): string {
  return `${date.toISOString().slice(0, 10)}|${officeId}|${mateSessionId ?? ""}`;
}
