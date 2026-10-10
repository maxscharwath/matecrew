import "server-only";

import { prisma } from "@/lib/prisma";
import { fromCents, toCents } from "@/lib/money";

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
      amountCents: true,
      currency: true,
      period: {
        select: {
          officeId: true,
          office: { select: { name: true } },
        },
      },
    },
  });

  // Summed in integer cents, converted to francs once at the end.
  const byOfficeAndCurrency = new Map<string, Omit<UnpaidDebt, "amount"> & { cents: number }>();

  for (const line of lines) {
    const { officeId, office } = line.period;
    const key = `${officeId}:${line.currency}`;
    const existing = byOfficeAndCurrency.get(key);

    if (existing) {
      existing.cents += line.amountCents;
      existing.lineCount += 1;
    } else {
      byOfficeAndCurrency.set(key, {
        officeId,
        officeName: office.name,
        currency: line.currency,
        cents: line.amountCents,
        lineCount: 1,
      });
    }
  }

  // Cents sum exactly: anything above zero is a real debt.
  return [...byOfficeAndCurrency.values()]
    .filter((d) => d.cents > 0)
    .sort((a, b) => b.cents - a.cents)
    .map(({ cents, ...debt }) => ({ ...debt, amount: fromCents(cents) }));
}

/// Totals per currency, so the headline never adds CHF to EUR.
export function totalsByCurrency(debts: UnpaidDebt[]): Map<string, number> {
  const cents = new Map<string, number>();
  for (const debt of debts) {
    cents.set(debt.currency, (cents.get(debt.currency) ?? 0) + toCents(debt.amount));
  }
  return new Map([...cents].map(([currency, total]) => [currency, fromCents(total)]));
}
