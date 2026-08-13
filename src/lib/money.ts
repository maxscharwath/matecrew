/**
 * Rounds to centimes. Money runs as a float through the costing replay and is
 * rounded once, where a number becomes something a person reads or owes —
 * rounding earlier makes the intermediate sums disagree with the totals.
 */
export function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
