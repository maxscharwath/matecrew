/**
 * Rounds to centimes. Money runs as a float through the costing replay and is
 * rounded once, where a number becomes something a person reads or owes —
 * rounding earlier makes the intermediate sums disagree with the totals.
 */
export function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Money as a person reads it. The locale is the recipient's, not the office's:
 * the same amount is "CHF 12.50" to one member and "12,50 CHF" to another.
 */
export function formatMoney(
  amount: number,
  locale: string,
  currency = "CHF",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}
