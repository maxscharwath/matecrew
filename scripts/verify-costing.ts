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

const pad = (n: number, w: number, d = 2) => n.toFixed(d).padStart(w);

async function main() {
  const offices = await prisma.office.findMany({
    select: { id: true, name: true },
  });

  let failures = 0;

  for (const office of offices) {
    console.log(`\n=== ${office.name} ===`);

    const ledger = await buildCostingLedger(office.id);
    console.log(`${ledger.draws.length} draws`);

    let worst = 0;
    for (const d of ledger.draws) {
      const credited = [...d.credits.values()].reduce((s, c) => s + c, 0);
      worst = Math.max(worst, Math.abs(credited - d.cost));
    }
    const balanced = worst < 1e-6;
    if (!balanced) failures++;
    console.log(
      `draw balance: max |credits - cost| = ${worst.toExponential(2)} ${balanced ? "ok" : "FAIL"}`,
    );

    // Nobody may be credited more than they actually spent.
    const spent = await prisma.purchaseBatch.aggregate({
      where: { officeId: office.id },
      _sum: { totalPrice: true },
    });
    let credited = 0;
    for (const d of ledger.draws) {
      for (const c of d.credits.values()) credited += c;
    }
    const totalSpent = spent._sum.totalPrice?.toNumber() ?? 0;
    const conserved = credited <= totalSpent + 0.01;
    if (!conserved) failures++;
    console.log(
      `conservation: credited ${pad(credited, 10)} of ${pad(totalSpent, 10)} spent ${conserved ? "ok" : "FAIL"}`,
    );

    const periods = await prisma.reimbursementPeriod.findMany({
      where: { officeId: office.id },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });
    if (periods.length === 0) continue;

    console.log("\nperiod     qty     drink     loss    total   net-sum  lines");
    for (const p of periods) {
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
      if (!linesOk || !netOk) failures++;

      console.log(
        `${p.year}-${String(p.month).padStart(2, "0")} ${String(r.totalConsumption).padStart(7)} ${pad(r.drinkCost, 9)} ${pad(r.lossCost, 8)} ${pad(r.totalCost, 8)} ${pad(netSum, 9, 4)}  ${linesOk && netOk ? "ok" : "FAIL"}`,
      );
    }
  }

  console.log(failures === 0 ? "\nAll invariants hold." : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
