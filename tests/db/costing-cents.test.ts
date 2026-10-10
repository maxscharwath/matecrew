import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@/generated/prisma/client";
import { replayCostingLedger, type CostingLedger, type CostingRows } from "@/lib/costing";
import { fromCents, roundCents, toCents } from "@/lib/money";
import { sliceLedger } from "@/lib/reimbursement-calc";

/**
 * Money moved from Postgres `Decimal(10,2)` columns to integer cents. The
 * costing replay (CUMP: moving average over the stock still there) must bill
 * exactly what it billed before, to the last bit of every float.
 */

/** What Prisma handed the replay before: the column's decimal string, as a `Decimal`, then `toNumber()`. */
function viaDecimal(cents: number): number {
  const units = Math.trunc(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return new Prisma.Decimal(`${units}.${fraction}`).toNumber();
}

const day = (month: number, date: number) => new Date(Date.UTC(2026, month - 1, date));
const items = {
  classic: { name: "Classic", sortOrder: 0 },
  ginger: { name: "Ginger", sortOrder: 1 },
} as const;
const payers = {
  alice: { name: "Alice" },
  bruno: { name: "Bruno" },
  chloe: { name: "Chloe" },
} as const;

/** Purchase lines as stored: integer cents. */
const lines: readonly {
  readonly batch: string;
  readonly itemId: keyof typeof items;
  readonly qty: number;
  readonly lineTotalCents: number;
  readonly at: Date;
  readonly payer: keyof typeof payers;
}[] = [
  { batch: "b1", itemId: "classic", qty: 30, lineTotalCents: 4350, at: day(1, 5), payer: "alice" }, // 1.45
  { batch: "b1", itemId: "ginger", qty: 12, lineTotalCents: 1800, at: day(1, 5), payer: "alice" }, // 1.50
  { batch: "b2", itemId: "classic", qty: 3, lineTotalCents: 700, at: day(1, 20), payer: "bruno" }, // 2.333...
  { batch: "b3", itemId: "classic", qty: 24, lineTotalCents: 3611, at: day(2, 3), payer: "chloe" }, // 1.5045833...
  { batch: "b4", itemId: "ginger", qty: 7, lineTotalCents: 1235, at: day(2, 10), payer: "bruno" }, // 1.7642857...
];

const drinkers = ["dora", "emil", "alice", "bruno"] as const;

function fixture(spend: (cents: number) => number): CostingRows {
  const entries = Array.from({ length: 70 }, (_, index) => {
    const userId = drinkers[index % drinkers.length];
    const itemId: keyof typeof items = index % 5 === 0 ? "ginger" : "classic";
    return {
      id: `e${String(index).padStart(3, "0")}`,
      userId,
      itemId,
      // Two drinks before the first delivery are billed at the office blend.
      date: index < 2 ? day(1, 2) : day(1 + Math.floor(index / 40), 6 + (index % 20)),
      qty: index % 9 === 0 ? 2 : 1,
      cancelledAt: index % 17 === 3 ? day(2, 15) : null,
      item: items[itemId],
      user: { name: userId },
    };
  });
  return {
    purchaseLines: lines.map((line) => ({
      itemId: line.itemId,
      qty: line.qty,
      spend: spend(line.lineTotalCents),
      item: items[line.itemId],
      batch: {
        id: line.batch,
        purchasedAt: line.at,
        deliveredAt: line.batch === "b3" ? null : line.at,
        paidByUserId: line.payer,
        paidBy: payers[line.payer],
      },
    })),
    entries,
    countLines: [
      // Shrinkage: three cans gone, billed over February's drinkers.
      { id: "c1", itemId: "classic", delta: -3, item: items.classic, count: { countedAt: day(2, 20) } },
      // A surplus: one can found again.
      { id: "c2", itemId: "ginger", delta: 1, item: items.ginger, count: { countedAt: day(2, 21) } },
    ],
  };
}

/** Everything a ledger exposes, the price lookup sampled since a function cannot be compared. */
function observable(ledger: CostingLedger) {
  const samples = [day(1, 1), day(1, 5), day(1, 25), day(2, 3), day(2, 28)].flatMap((at) =>
    Object.keys(items).map((itemId) => ledger.priceAt(itemId, at)),
  );
  return {
    draws: ledger.draws,
    priceHistory: ledger.priceHistory,
    samples,
    userNames: ledger.userNames,
    itemNames: ledger.itemNames,
  };
}

test("every stored amount reaches the replay as the same float as through Decimal", () => {
  for (let cents = 0; cents <= 200_000; cents++) {
    assert.equal(fromCents(cents), viaDecimal(cents), `${cents} cents`);
  }
  // The column held up to 99,999,999.99.
  for (const cents of [99_999_999_99, 12_345_678_90, 1_000_000_01]) {
    assert.equal(fromCents(cents), viaDecimal(cents), `${cents} cents`);
  }
});

test("the CUMP replay and the settlements are identical on cents and on Decimal", () => {
  const before = replayCostingLedger(fixture(viaDecimal));
  const after = replayCostingLedger(fixture(fromCents));
  assert.deepEqual(observable(after), observable(before));

  for (const [start, end] of [
    [day(1, 1), day(1, 31)],
    [day(2, 1), day(2, 28)],
  ]) {
    assert.deepEqual(sliceLedger(after, start, end), sliceLedger(before, start, end));
  }

  // The fixture does exercise the moving average and the shrinkage.
  const classicPrices = after.priceHistory.filter((p) => p.itemId === "classic").map((p) => p.unitCost);
  assert.equal(classicPrices.length, 3);
  assert.ok(after.draws.some((d) => d.kind === "SHRINKAGE" && d.cost > 0));
  assert.ok(after.draws.some((d) => d.kind === "RETURN"));
  assert.ok(sliceLedger(after, day(2, 1), day(2, 28)).lossCost > 0);
});

test("toCents rounds half away from zero", () => {
  // Binary-exact halves, so the rounding itself is what is tested.
  for (const [amount, cents] of [
    [0.125, 13],
    [0.375, 38],
    [1.625, 163],
    [-0.125, -13],
    [-0.375, -38],
    [-1.625, -163],
  ] as const) {
    assert.equal(toCents(amount), cents, `${amount}`);
  }
});

test("toCents never produces -0", () => {
  for (const amount of [0, -0, -0.001, 0.004, -0.004]) {
    assert.ok(Object.is(toCents(amount), 0), `${amount}`);
  }
});

test("cents survive the round trip through francs", () => {
  for (let cents = 0; cents <= 100_000; cents++) {
    assert.equal(toCents(fromCents(cents)), cents);
    assert.equal(toCents(fromCents(-cents)), cents === 0 ? 0 : -cents);
  }
});

test("toCents agrees with roundCents, which wrote the Decimal columns", () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 48_271) % 2_147_483_647;
    return seed / 2_147_483_647;
  };
  for (let index = 0; index < 50_000; index++) {
    const amount = random() * 5_000;
    assert.equal(fromCents(toCents(amount)), roundCents(amount), `${amount}`);
  }
});

test("toCents refuses what is not an amount", () => {
  for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => toCents(amount), RangeError);
  }
});
