/**
 * Account synchronization & merge engine.
 *
 * Detects duplicate `User` rows that belong to the same person across aliased
 * email domains (see `email-identity.ts`) and merges one account into another,
 * re-homing every related record so no consumption, reimbursement, membership
 * or Slack link is lost.
 */

import { commitBatch, expectRows, prisma, retryOnConflict } from "@/lib/prisma";
import { roleList, rolesSelect } from "@/lib/membership-roles";
import type { BatchClient } from "@/platform";
import { canonicalEmailKey } from "@/lib/email-identity";
import type { Role } from "@/generated/prisma/client";

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
 * is deleted. Throws a `MergeError` if the accounts don't exist, are identical,
 * or don't share the same canonical identity (the latter doubles as the "same
 * duplicate group" guard, since the canonical key *is* the group key).
 *
 * Both accounts are read, every write is planned in code, then the whole merge
 * commits as one atomic batch: all of it, or nothing. Rows that would collide
 * with the target's (same office, same day and session) are dropped by id;
 * everything else is moved by owner, so a row the source gained after the read
 * moves too, or, if it collides, fails the batch on its unique key. Deleting
 * the source must touch exactly one row, so a second merge of the same pair
 * finds nothing to do. A conflict reads both accounts again and replans.
 */
export async function mergeAccounts(
  targetUserId: string,
  sourceUserId: string
): Promise<MergeSummary> {
  if (targetUserId === sourceUserId) {
    throw new MergeError("SAME_ACCOUNT");
  }

  await retryOnConflict(async () => {
    const [target, source] = await Promise.all([loadMergeSide(targetUserId), loadMergeSide(sourceUserId)]);
    if (!target || !source) {
      throw new MergeError("NOT_FOUND");
    }
    const targetKey = canonicalEmailKey(target.email);
    if (!targetKey || targetKey !== canonicalEmailKey(source.email)) {
      throw new MergeError("IDENTITY_MISMATCH");
    }
    const plan = planMerge(target, source);
    await commitBatch((db) => mergeWrites(db, target.id, source.id, plan));
  });
  return { targetUserId, sourceUserId };
}

/** One side of a merge, with what decides which of its rows collide. */
function loadMergeSide(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: { include: rolesSelect },
      joinRequests: { select: { id: true, officeId: true } },
      accounts: { select: { id: true, providerId: true } },
      dailyRequests: {
        select: { id: true, date: true, officeId: true, mateSessionId: true },
      },
    },
  });
}

type MergeSide = NonNullable<Awaited<ReturnType<typeof loadMergeSide>>>;

/** Gaps on the target that the source fills. */
interface MergeFill {
  readonly slackUserId?: string;
  readonly image?: string;
  readonly defaultOfficeId?: string;
  readonly emailVerified?: true;
}

interface MembershipFold {
  readonly sourceId: string;
  readonly targetId: string;
  /** Roles the source holds in that office and the target does not. */
  readonly addRoles: Role[];
}

interface MergePlan {
  /** Source provider accounts the target already has. */
  readonly accountsToDrop: string[];
  /** Source memberships in an office the target is also in. */
  readonly membershipsToFold: MembershipFold[];
  /** Source join requests to an office the target also asked to join. */
  readonly joinToDrop: string[];
  /** Source daily requests the target already has for the same day and session. */
  readonly dailyToDrop: string[];
  readonly fill: MergeFill;
}

function planMerge(target: MergeSide, source: MergeSide): MergePlan {
  // ── Provider accounts: move only providers the target lacks; drop dupes ──
  const targetProviders = new Set(target.accounts.map((a) => a.providerId));
  const accountsToDrop: string[] = [];
  for (const acc of source.accounts) {
    if (targetProviders.has(acc.providerId)) accountsToDrop.push(acc.id);
    else targetProviders.add(acc.providerId);
  }

  // ── Memberships: unique [userId, officeId]; union roles on conflict ──
  const targetMembershipByOffice = new Map(target.memberships.map((m) => [m.officeId, m]));
  const membershipsToFold = source.memberships.flatMap((m): MembershipFold[] => {
    const existing = targetMembershipByOffice.get(m.officeId);
    if (!existing) return [];
    const held = new Set(roleList(existing));
    return [{ sourceId: m.id, targetId: existing.id, addRoles: roleList(m).filter((role) => !held.has(role)) }];
  });

  // ── Join requests: unique [userId, officeId]; keep the target's ──
  const targetJoinOffices = new Set(target.joinRequests.map((j) => j.officeId));
  const joinToDrop = source.joinRequests.filter((j) => targetJoinOffices.has(j.officeId)).map((j) => j.id);

  // ── Daily requests: unique [date, officeId, userId, mateSessionId]. SQL
  //    (SQLite and Postgres alike) treats NULLs as distinct, so rows with a
  //    null mateSessionId never collide and always move. Only dedupe the
  //    keyed ones. ──
  const targetDailyKeys = new Set(
    target.dailyRequests
      .filter((d) => d.mateSessionId !== null)
      .map((d) => dailyRequestKey(d.date, d.officeId, d.mateSessionId))
  );
  const dailyToDrop = source.dailyRequests
    .filter((d) => d.mateSessionId !== null && targetDailyKeys.has(dailyRequestKey(d.date, d.officeId, d.mateSessionId)))
    .map((d) => d.id);

  return { accountsToDrop, membershipsToFold, joinToDrop, dailyToDrop, fill: fillFromSource(target, source) };
}

/** The target's empty fields the source can fill. */
function fillFromSource(target: MergeSide, source: MergeSide): MergeFill {
  // Offices the target belongs to after the membership merge.
  const targetOfficeIds = new Set([...target.memberships, ...source.memberships].map((m) => m.officeId));
  const defaultOfficeId =
    source.defaultOfficeId && targetOfficeIds.has(source.defaultOfficeId) ? source.defaultOfficeId : null;
  return {
    ...(!target.slackUserId && source.slackUserId ? { slackUserId: source.slackUserId } : {}),
    ...(!target.image && source.image ? { image: source.image } : {}),
    ...(!target.defaultOfficeId && defaultOfficeId ? { defaultOfficeId } : {}),
    ...(!target.emailVerified && source.emailVerified ? { emailVerified: true as const } : {}),
  };
}

/** Every write of a merge, in order, for one atomic batch. */
function mergeWrites(db: BatchClient, to: string, from: string, plan: MergePlan) {
  const reassign = { where: { userId: from }, data: { userId: to } };
  return [
    // ── Sessions: revoke the source's (never transfer auth to another
    //    identity); the absorbed person must re-authenticate. ──
    db.session.deleteMany({ where: { userId: from } }),

    // ── Simple FK reassignments (no unique constraints) ──
    db.consumptionEntry.updateMany(reassign),
    db.stockMovement.updateMany(reassign),
    db.badge.updateMany(reassign),
    db.stockCount.updateMany({ where: { countedByUserId: from }, data: { countedByUserId: to } }),
    db.purchaseBatch.updateMany({ where: { orderedByUserId: from }, data: { orderedByUserId: to } }),
    db.purchaseBatch.updateMany({ where: { paidByUserId: from }, data: { paidByUserId: to } }),
    db.reimbursementLine.updateMany({ where: { fromUserId: from }, data: { fromUserId: to } }),
    db.reimbursementLine.updateMany({ where: { toUserId: from }, data: { toUserId: to } }),
    // Drop lines that collapsed into self-reimbursements (the two parties
    // turned out to be the same person — they net to zero).
    db.reimbursementLine.deleteMany({ where: { fromUserId: to, toUserId: to } }),

    // ── Provider accounts, memberships, join and daily requests: drop the
    //    source's duplicates, then move the rest by owner. ──
    db.account.deleteMany({ where: { id: { in: plan.accountsToDrop } } }),
    db.account.updateMany(reassign),
    ...plan.membershipsToFold.flatMap((fold) => [
      db.membershipRole.createMany({ data: fold.addRoles.map((role) => ({ membershipId: fold.targetId, role })) }),
      db.membership.deleteMany({ where: { id: fold.sourceId } }),
    ]),
    db.membership.updateMany(reassign),
    db.joinRequest.deleteMany({ where: { id: { in: plan.joinToDrop } } }),
    db.joinRequest.updateMany(reassign),
    db.dailyRequest.deleteMany({ where: { id: { in: plan.dailyToDrop } } }),
    db.dailyRequest.updateMany(reassign),

    // ── Scalar fields: free the source's unique slackUserId, then fill the
    //    target's gaps, each only while it is still empty. ──
    db.user.updateMany({ where: { id: from }, data: { slackUserId: null } }),
    ...fillWrites(db, to, plan.fill),

    // ── Remove the now-empty source account ──
    expectRows(db.user.deleteMany({ where: { id: from } }), 1),
  ];
}

function fillWrites(db: BatchClient, userId: string, fill: MergeFill) {
  const { slackUserId, image, defaultOfficeId, emailVerified } = fill;
  return [
    ...(slackUserId ? [db.user.updateMany({ where: { id: userId, slackUserId: null }, data: { slackUserId } })] : []),
    ...(image ? [db.user.updateMany({ where: { id: userId, image: null }, data: { image } })] : []),
    ...(defaultOfficeId
      ? [db.user.updateMany({ where: { id: userId, defaultOfficeId: null }, data: { defaultOfficeId } })]
      : []),
    ...(emailVerified
      ? [db.user.updateMany({ where: { id: userId, emailVerified: false }, data: { emailVerified } })]
      : []),
  ];
}

function dailyRequestKey(
  date: Date,
  officeId: string,
  mateSessionId: string | null
): string {
  return `${date.toISOString().slice(0, 10)}|${officeId}|${mateSessionId ?? ""}`;
}
