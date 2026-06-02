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

export type MergeErrorCode =
  | "SAME_ACCOUNT"
  | "NOT_FOUND"
  | "IDENTITY_MISMATCH";

/** Thrown for expected, user-presentable merge failures (mapped to i18n). */
export class MergeError extends Error {
  constructor(public readonly code: MergeErrorCode) {
    super(code);
    this.name = "MergeError";
  }
}

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
    reimbursementLines: number;
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
          reimbursementsFrom: true,
          reimbursementsTo: true,
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
        reimbursementLines:
          u._count.reimbursementsFrom + u._count.reimbursementsTo,
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
 * is deleted. Runs in a single transaction. Throws a `MergeError` if the
 * accounts don't exist, are identical, or don't share the same canonical
 * identity (the latter doubles as the "same duplicate group" guard, since the
 * canonical key *is* the group key).
 */
export async function mergeAccounts(
  targetUserId: string,
  sourceUserId: string
): Promise<MergeSummary> {
  if (targetUserId === sourceUserId) {
    throw new MergeError("SAME_ACCOUNT");
  }

  return prisma.$transaction(
    async (tx) => {
      const [target, source] = await Promise.all([
        tx.user.findUnique({
          where: { id: targetUserId },
          include: {
            memberships: true,
            joinRequests: true,
            accounts: { select: { providerId: true } },
            dailyRequests: {
              select: { date: true, officeId: true, mateSessionId: true },
            },
          },
        }),
        tx.user.findUnique({
          where: { id: sourceUserId },
          include: {
            memberships: true,
            joinRequests: true,
            accounts: { select: { id: true, providerId: true } },
            dailyRequests: {
              select: { id: true, date: true, officeId: true, mateSessionId: true },
            },
          },
        }),
      ]);

      if (!target || !source) {
        throw new MergeError("NOT_FOUND");
      }

      const targetKey = canonicalEmailKey(target.email);
      const sourceKey = canonicalEmailKey(source.email);
      if (!targetKey || targetKey !== sourceKey) {
        throw new MergeError("IDENTITY_MISMATCH");
      }

      // ── Sessions: revoke the source's (never transfer auth to another
      //    identity); the absorbed person must re-authenticate. ──
      await tx.session.deleteMany({ where: { userId: sourceUserId } });

      // ── Simple FK reassignments (no unique constraints) ──
      const reassign = {
        where: { userId: sourceUserId },
        data: { userId: targetUserId },
      };
      await tx.consumptionEntry.updateMany(reassign);
      await tx.stockMovement.updateMany(reassign);
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
      // Drop lines that collapsed into self-reimbursements (the two parties
      // turned out to be the same person — they net to zero).
      await tx.reimbursementLine.deleteMany({
        where: { fromUserId: targetUserId, toUserId: targetUserId },
      });

      // ── Provider accounts: move only providers the target lacks; drop dupes ──
      const targetProviders = new Set(target.accounts.map((a) => a.providerId));
      const accountsToMove: string[] = [];
      const accountsToDrop: string[] = [];
      for (const acc of source.accounts) {
        if (targetProviders.has(acc.providerId)) {
          accountsToDrop.push(acc.id);
        } else {
          accountsToMove.push(acc.id);
          targetProviders.add(acc.providerId);
        }
      }
      if (accountsToDrop.length > 0) {
        await tx.account.deleteMany({ where: { id: { in: accountsToDrop } } });
      }
      if (accountsToMove.length > 0) {
        await tx.account.updateMany({
          where: { id: { in: accountsToMove } },
          data: { userId: targetUserId },
        });
      }

      // ── Memberships: unique [userId, officeId]; union roles on conflict ──
      const targetMembershipByOffice = new Map(
        target.memberships.map((m) => [m.officeId, m])
      );
      const membershipsToMove: string[] = [];
      for (const m of source.memberships) {
        const existing = targetMembershipByOffice.get(m.officeId);
        if (existing) {
          const mergedRoles = Array.from(
            new Set([...existing.roles, ...m.roles])
          );
          await tx.membership.update({
            where: { id: existing.id },
            data: { roles: mergedRoles },
          });
          await tx.membership.delete({ where: { id: m.id } });
        } else {
          membershipsToMove.push(m.id);
        }
      }
      if (membershipsToMove.length > 0) {
        await tx.membership.updateMany({
          where: { id: { in: membershipsToMove } },
          data: { userId: targetUserId },
        });
      }

      // ── Join requests: unique [userId, officeId]; keep the target's ──
      const targetJoinOffices = new Set(
        target.joinRequests.map((j) => j.officeId)
      );
      const joinToMove: string[] = [];
      const joinToDrop: string[] = [];
      for (const j of source.joinRequests) {
        if (targetJoinOffices.has(j.officeId)) joinToDrop.push(j.id);
        else joinToMove.push(j.id);
      }
      if (joinToDrop.length > 0) {
        await tx.joinRequest.deleteMany({ where: { id: { in: joinToDrop } } });
      }
      if (joinToMove.length > 0) {
        await tx.joinRequest.updateMany({
          where: { id: { in: joinToMove } },
          data: { userId: targetUserId },
        });
      }

      // ── Daily requests: unique [date, officeId, userId, mateSessionId].
      //    Postgres treats NULLs as distinct, so rows with a null mateSessionId
      //    never collide — always move them. Only dedupe the keyed ones. ──
      const targetDailyKeys = new Set(
        target.dailyRequests
          .filter((d) => d.mateSessionId !== null)
          .map((d) => dailyRequestKey(d.date, d.officeId, d.mateSessionId))
      );
      const dailyToMove: string[] = [];
      const dailyToDrop: string[] = [];
      for (const d of source.dailyRequests) {
        if (d.mateSessionId === null) {
          dailyToMove.push(d.id);
          continue;
        }
        const key = dailyRequestKey(d.date, d.officeId, d.mateSessionId);
        if (targetDailyKeys.has(key)) {
          dailyToDrop.push(d.id);
        } else {
          dailyToMove.push(d.id);
          targetDailyKeys.add(key);
        }
      }
      if (dailyToDrop.length > 0) {
        await tx.dailyRequest.deleteMany({ where: { id: { in: dailyToDrop } } });
      }
      if (dailyToMove.length > 0) {
        await tx.dailyRequest.updateMany({
          where: { id: { in: dailyToMove } },
          data: { userId: targetUserId },
        });
      }

      // ── Scalar fields: fill gaps on the target, then free the source's ──
      // Release the source's unique slackUserId before re-assigning it.
      await tx.user.update({
        where: { id: sourceUserId },
        data: { slackUserId: null },
      });

      // Offices the target belongs to after the membership merge.
      const targetOfficeIds = new Set<string>([
        ...target.memberships.map((m) => m.officeId),
        ...source.memberships.map((m) => m.officeId),
      ]);

      const targetPatch: Prisma.UserUpdateInput = {};
      if (!target.slackUserId && source.slackUserId) {
        targetPatch.slackUserId = source.slackUserId;
      }
      if (!target.image && source.image) {
        targetPatch.image = source.image;
      }
      if (
        !target.defaultOfficeId &&
        source.defaultOfficeId &&
        targetOfficeIds.has(source.defaultOfficeId)
      ) {
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
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
}

function dailyRequestKey(
  date: Date,
  officeId: string,
  mateSessionId: string | null
): string {
  return `${date.toISOString().slice(0, 10)}|${officeId}|${mateSessionId ?? ""}`;
}
