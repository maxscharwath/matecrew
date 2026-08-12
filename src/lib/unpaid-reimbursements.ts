import "server-only";

import { prisma } from "@/lib/prisma";

/// Money the user still owes in one office, for one currency. An office can
/// appear twice if its lines were frozen under different currencies.
export interface UnpaidDebt {
  officeId: string;
  officeName: string;
  currency: string;
  amount: number;
  lineCount: number;
}

/// Every pending payment line where the user is the payer, grouped by office.
/// Only offices the user is still a member of are returned — a debt in an
/// office they left would link straight into the join-request gate.
export async function getUnpaidDebts(userId: string): Promise<UnpaidDebt[]> {
  const lines = await prisma.reimbursementLine.findMany({
    where: {
      fromUserId: userId,
      status: "PENDING",
      period: {
        office: { memberships: { some: { userId } } },
      },
    },
    select: {
      amount: true,
      currency: true,
      period: {
        select: {
          officeId: true,
          office: { select: { name: true } },
        },
      },
    },
  });

  const byOfficeAndCurrency = new Map<string, UnpaidDebt>();

  for (const line of lines) {
    const { officeId, office } = line.period;
    const key = `${officeId}:${line.currency}`;
    const existing = byOfficeAndCurrency.get(key);

    if (existing) {
      existing.amount += line.amount.toNumber();
      existing.lineCount += 1;
    } else {
      byOfficeAndCurrency.set(key, {
        officeId,
        officeName: office.name,
        currency: line.currency,
        amount: line.amount.toNumber(),
        lineCount: 1,
      });
    }
  }

  // Rounding noise on Decimal sums would otherwise surface a "CHF 0.00" debt.
  return [...byOfficeAndCurrency.values()]
    .filter((d) => d.amount > 0.01)
    .sort((a, b) => b.amount - a.amount);
}

/// Totals per currency, so the headline never adds CHF to EUR.
export function totalsByCurrency(debts: UnpaidDebt[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const debt of debts) {
    totals.set(debt.currency, (totals.get(debt.currency) ?? 0) + debt.amount);
  }
  return totals;
}
