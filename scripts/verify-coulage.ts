/**
 * Audits the bill against the coulage — the cans that go missing between two
 * counts and get shared out over the period's drinkers.
 *
 * Usage:  bun scripts/verify-coulage.ts
 *
 * `verify-costing.ts` proves the ledger conserves value; this proves the two
 * things a member's invoice depends on once value has vanished:
 *
 *   1. every centime of shrinkage lands on somebody, in proportion to what
 *      they drank, and inside their bill rather than beside it, and
 *   2. the payment lines a reminder chases still add up to what each person
 *      owes — coulage included.
 *
 * Nothing is written. An office with no shrinkage on record proves nothing, so
 * the loss is injected into a real ledger and the period re-sliced; the check
 * against the *stored* payment lines runs on the real data as it stands.
 */
import { prisma } from "../src/lib/prisma";
import { buildCostingLedger, type CostDraw } from "../src/lib/costing";
import { sliceLedger, matchBalances } from "../src/lib/reimbursement-calc";

const EPS = 0.011; // one centime of rounding per person, plus slack
let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? "  " + detail : ""}`);
};

for (const office of await prisma.office.findMany({ select: { id: true, name: true } })) {
  const ledger = await buildCostingLedger(office.id);
  const periods = await prisma.reimbursementPeriod.findMany({
    where: { officeId: office.id },
    orderBy: { startDate: "asc" },
    include: { lines: true },
  });

  for (const period of periods) {
    const base = sliceLedger(ledger, period.startDate, period.endDate);
    if (base.totalConsumption === 0) continue;

    console.log(`\n=== ${office.name} ${period.year}-${String(period.month).padStart(2, "0")} ===`);
    console.log(`  drunk ${base.totalConsumption} cans, drinkCost ${base.drinkCost.toFixed(2)}`);

    // ── A. the bill as it stands: pending lines must equal what is still owed
    const pendingByUser = new Map<string, number>();
    const paidByUser = new Map<string, number>();
    for (const l of period.lines) {
      const bucket = l.status === "PAID" ? paidByUser : pendingByUser;
      bucket.set(l.fromUserId, (bucket.get(l.fromUserId) ?? 0) + l.amount.toNumber());
    }
    for (const share of base.shares) {
      if (share.netOwed <= 0.01) continue;
      const pending = pendingByUser.get(share.userId) ?? 0;
      const paid = paidByUser.get(share.userId) ?? 0;
      check(
        Math.abs(pending + paid - share.netOwed) < EPS,
        `${share.userName.padEnd(14)} lines = netOwed`,
        `pending ${pending.toFixed(2)} + paid ${paid.toFixed(2)} vs ${share.netOwed.toFixed(2)}`,
      );
    }

    // ── B. same period, with cans gone missing
    const drinkers = base.shares.filter((s) => s.qty > 0);
    if (drinkers.length === 0) continue;

    const itemId = base.itemPrices[0].itemId;
    // The seed prices most months at 0.00; a coulage of zero francs proves
    // nothing, so fall back to a plausible price when the pool has none.
    const unit = base.itemPrices[0].unitPrice > 0 ? base.itemPrices[0].unitPrice : 1.45;
    const LOST = 7;
    const lossCost = Math.round(LOST * unit * 100) / 100;
    // Credit the shrinkage to whoever paid for the period's drinking, the way
    // a real draw from the pool would.
    const payer = [...base.shares].sort((a, b) => b.amountPaid - a.amountPaid)[0];
    const injected: CostDraw = {
      kind: "SHRINKAGE",
      at: new Date(period.startDate.getTime() + 12 * 3600 * 1000),
      itemId,
      qty: LOST,
      cost: lossCost,
      credits: new Map([[payer.userId, lossCost]]),
      sourceId: "synthetic-coulage",
    };
    const spiked = {
      ...ledger,
      draws: [...ledger.draws, injected].sort((a, b) => a.at.getTime() - b.at.getTime()),
    };
    const withLoss = sliceLedger(spiked, period.startDate, period.endDate);

    console.log(`  injected ${LOST} missing cans @ ${unit.toFixed(2)} = ${lossCost.toFixed(2)}`);
    check(withLoss.lossQty === LOST, "lossQty carried through", `${withLoss.lossQty}`);
    check(Math.abs(withLoss.lossCost - lossCost) < EPS, "lossCost carried through", `${withLoss.lossCost.toFixed(2)}`);
    check(withLoss.unallocatedLossCost === 0, "all of it billable", `${withLoss.unallocatedLossCost.toFixed(2)}`);

    // every centime of coulage lands on somebody
    const sumLoss = withLoss.shares.reduce((s, x) => s + x.lossShare, 0);
    check(Math.abs(sumLoss - lossCost) < drinkers.length * 0.01, "Σ lossShare = lossCost", `${sumLoss.toFixed(2)} vs ${lossCost.toFixed(2)}`);

    // shared out by what each person drank, and only among drinkers
    const totalQty = drinkers.reduce((s, x) => s + x.qty, 0);
    for (const s of withLoss.shares) {
      const expected = s.qty > 0 ? Math.round((s.qty / totalQty) * lossCost * 100) / 100 : 0;
      check(Math.abs(s.lossShare - expected) < EPS, `${s.userName.padEnd(14)} lossShare ∝ qty`, `${s.lossShare.toFixed(2)} vs ${expected.toFixed(2)} (${s.qty} cans)`);
    }

    // the coulage is inside the bill, not bolted next to it
    for (const s of withLoss.shares) {
      const before = base.shares.find((b) => b.userId === s.userId)!;
      check(Math.abs(s.costShare - (before.costShare + s.lossShare)) < EPS, `${s.userName.padEnd(14)} costShare = drink + coulage`);
    }

    // the office still balances, and nobody is charged for value that vanished
    const sumNet = withLoss.shares.reduce((s, x) => s + x.netOwed, 0);
    check(Math.abs(sumNet) < withLoss.shares.length * 0.01, "Σ netOwed = 0", sumNet.toFixed(4));
    check(Math.abs(withLoss.totalCost - (withLoss.drinkCost + withLoss.lossCost)) < EPS, "totalCost = drink + coulage");

    // what the reminder would chase: the payment lines
    const lines = matchBalances(withLoss.shares.map((s) => ({ userId: s.userId, netOwed: s.netOwed })));
    for (const s of withLoss.shares) {
      if (s.netOwed <= 0.01) continue;
      const owed = lines.filter((l) => l.fromUserId === s.userId).reduce((t, l) => t + l.amount, 0);
      check(Math.abs(owed - s.netOwed) < EPS, `${s.userName.padEnd(14)} Σ lines = netOwed (coulage in)`, `${owed.toFixed(2)} vs ${s.netOwed.toFixed(2)}`);
    }
  }
}

console.log(failures === 0 ? "\nAll coulage invariants hold." : `\n${failures} FAILURE(S)`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
