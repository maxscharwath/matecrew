/**
 * Audits the costing engine against the live database.
 *
 * Usage:  bun scripts/verify-costing.ts
 *
 * Money math has no unit tests here, so this is the check: it walks every
 * office and asserts the two invariants the settlement depends on —
 *
 *   1. every draw credits exactly what it charges, and
 *   2. each period's payment lines move exactly each person's net balance.
 *
 *   3. no payer is ever credited more than they spent.
 */
import { prisma } from "../src/lib/prisma";
import { buildCostingLedger } from "../src/lib/costing";
import { sliceLedger } from "../src/lib/reimbursement-calc";
import { fromCents } from "../src/lib/money";

const pad = (n: number, w: number, d = 2) => n.toFixed(d).padStart(w);

type Ledger = Awaited<ReturnType<typeof buildCostingLedger>>;

/** Invariant 1: every draw credits exactly what it charges. Returns the failures (0 or 1). */
function checkDrawBalance(ledger: Ledger): number {
  let worst = 0;
  for (const d of ledger.draws) {
    const credited = [...d.credits.values()].reduce((s, c) => s + c, 0);
    worst = Math.max(worst, Math.abs(credited - d.cost));
  }
  const balanced = worst < 1e-6;
  console.log(
    `draw balance: max |credits - cost| = ${worst.toExponential(2)} ${balanced ? "ok" : "FAIL"}`,
  );
  return balanced ? 0 : 1;
}

/** Invariant 3: nobody may be credited more than they actually spent. Returns the failures (0 or 1). */
async function checkConservation(officeId: string, ledger: Ledger): Promise<number> {
  const spent = await prisma.purchaseBatch.aggregate({
    where: { officeId },
    _sum: { totalPriceCents: true },
  });
  let credited = 0;
  for (const d of ledger.draws) {
    for (const c of d.credits.values()) credited += c;
  }
  const totalSpent = fromCents(spent._sum.totalPriceCents ?? 0);
  const conserved = credited <= totalSpent + 0.01;
  console.log(
    `conservation: credited ${pad(credited, 10)} of ${pad(totalSpent, 10)} spent ${conserved ? "ok" : "FAIL"}`,
  );
  return conserved ? 0 : 1;
}

type Period = { year: number; month: number; startDate: Date; endDate: Date };

/** Invariant 2 for one period: its payment lines move exactly each person's net balance. Returns the failures (0 or 1). */
function checkPeriod(ledger: Ledger, p: Period): number {
  const r = sliceLedger(ledger, p.startDate, p.endDate);
  const netSum = r.shares.reduce((s, x) => s + x.netOwed, 0);

  const moved = new Map<string, number>();
  for (const l of r.lines) {
    moved.set(l.fromUserId, (moved.get(l.fromUserId) ?? 0) + l.amount);
    moved.set(l.toUserId, (moved.get(l.toUserId) ?? 0) - l.amount);
  }
  const linesOk = r.shares.every(
    (s) => Math.abs((moved.get(s.userId) ?? 0) - s.netOwed) < 0.02,
  );
  // Cents rounding on each share means the sum drifts a little; more than a
  // few centimes means the model itself is leaking money.
  const netOk = Math.abs(netSum) < 0.05;
  const ok = linesOk && netOk;

  console.log(
    `${p.year}-${String(p.month).padStart(2, "0")} ${String(r.totalConsumption).padStart(7)} ${pad(r.drinkCost, 9)} ${pad(r.lossCost, 8)} ${pad(r.totalCost, 8)} ${pad(netSum, 9, 4)}  ${ok ? "ok" : "FAIL"}`,
  );
  return ok ? 0 : 1;
}

async function checkPeriods(officeId: string, ledger: Ledger): Promise<number> {
  const periods = await prisma.reimbursementPeriod.findMany({
    where: { officeId },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  if (periods.length === 0) return 0;

  console.log("\nperiod     qty     drink     loss    total   net-sum  lines");
  return periods.reduce((failures, p) => failures + checkPeriod(ledger, p), 0);
}

/** Every invariant for one office; returns how many failed. */
async function auditOffice(office: { id: string; name: string }): Promise<number> {
  console.log(`\n=== ${office.name} ===`);

  const ledger = await buildCostingLedger(office.id);
  console.log(`${ledger.draws.length} draws`);

  const unbalanced = checkDrawBalance(ledger);
  const leaking = await checkConservation(office.id, ledger);
  const periods = await checkPeriods(office.id, ledger);
  return unbalanced + leaking + periods;
}

async function main() {
  const offices = await prisma.office.findMany({
    select: { id: true, name: true },
  });

  // One office after the other, so each one's report prints as a block.
  const failures = await offices.reduce<Promise<number>>(
    (previous, office) => previous.then(async (sum) => sum + (await auditOffice(office))),
    Promise.resolve(0),
  );

  console.log(failures === 0 ? "\nAll invariants hold." : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
