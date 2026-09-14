import "server-only";

import { prisma } from "@/lib/prisma";
import { calculateReimbursements, type ReimbursementResult } from "@/lib/reimbursement-calc";
import { generateUserSettlementPdf } from "@/lib/pdf-export";
import { roundCents } from "@/lib/money";
import {
  buildUserSettlementKey,
  fileExists,
  internalFileUrl,
  uploadFile,
} from "@/lib/storage";

/**
 * One person's statement for one period — the "facture" they download from
 * their reimbursements page and the one the monthly mail attaches.
 *
 * Both paths go through here so a member cannot receive one document by mail
 * and find a different one behind the button. The rendered file is cached in
 * storage under a per-(period, user) key; `wantBytes` says whether the caller
 * needs the bytes back (the mail does, a download link does not), which is the
 * only reason to re-render a statement that is already stored.
 */

/** One payment this person has to make, or to expect. */
export interface SettlementPaymentLine {
  direction: "pay" | "receive";
  otherUserName: string;
  amount: number;
}

export interface UserSettlement {
  key: string;
  url: string;
  /** Only populated when the caller asked for the bytes. */
  buffer: Buffer | null;
  /** Cans drunk in the period, and the francs that follow from them. */
  qty: number;
  costShare: number;
  /** What one can cost them on average, their share of the losses aside. */
  avgUnitPrice: number;
  /** Their share of the cans that went missing at inventory. */
  lossShare: number;
  /** Positive = they owe, negative = they are owed, 0 = settled. */
  netOwed: number;
  /** Who to settle with — the same lines the PDF lists. */
  lines: SettlementPaymentLine[];
}

export async function buildUserSettlement(opts: {
  periodId: string;
  userId: string;
  wantBytes?: boolean;
  /** Pass a settlement already computed for this period to skip the replay. */
  result?: ReimbursementResult;
}): Promise<UserSettlement | null> {
  const { periodId, userId, wantBytes = false } = opts;

  const [period, user] = await Promise.all([
    prisma.reimbursementPeriod.findUnique({
      where: { id: periodId },
      include: {
        office: { select: { name: true } },
        lines: {
          where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
          include: {
            fromUser: { select: { name: true } },
            toUser: { select: { name: true } },
          },
        },
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, locale: true },
    }),
  ]);
  if (!period || !user) return null;

  const key = buildUserSettlementKey(periodId, userId);
  const url = internalFileUrl(key);

  const result =
    opts.result ??
    (await calculateReimbursements(
      period.officeId,
      period.startDate,
      period.endDate,
    ));
  const share = result.shares.find((s) => s.userId === userId);

  // The person's average price across what they drank. Their share of the
  // missing cans is left out — it is a loss, not a price — and shown apart.
  const avgUnitPrice =
    share && share.qty > 0
      ? roundCents((share.costShare - share.lossShare) / share.qty)
      : result.avgUnitPrice;

  const lines = period.lines.map((l) =>
    l.fromUserId === userId
      ? {
          direction: "pay" as const,
          otherUserName: l.toUser.name,
          amount: l.amount.toNumber(),
        }
      : {
          direction: "receive" as const,
          otherUserName: l.fromUser.name,
          amount: l.amount.toNumber(),
        },
  );

  const figures = {
    qty: share?.qty ?? 0,
    costShare: share?.costShare ?? 0,
    avgUnitPrice,
    lossShare: share?.lossShare ?? 0,
    netOwed: share?.netOwed ?? 0,
    lines,
  };

  const cached = await fileExists(key);
  if (cached && !wantBytes) {
    return { key, url, buffer: null, ...figures };
  }

  const buffer = await generateUserSettlementPdf({
    officeName: period.office.name,
    userName: user.name,
    startDate: period.startDate,
    endDate: period.endDate,
    avgUnitPrice,
    qty: share?.qty ?? 0,
    costShare: share?.costShare ?? 0,
    lossShare: share?.lossShare ?? 0,
    amountPaid: share?.amountPaid ?? 0,
    netOwed: share?.netOwed ?? 0,
    lines,
    locale: user.locale,
  });

  if (!cached) {
    await uploadFile({ key, body: buffer, contentType: "application/pdf" });
  }

  return { key, url, buffer, ...figures };
}
