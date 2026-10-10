/**
 * Rounds to centimes. Money runs as a float through the costing replay and is
 * rounded once, where a number becomes something a person reads or owes —
 * rounding earlier makes the intermediate sums disagree with the totals.
 */
export function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Money is stored as integer cents (`…Cents` columns) and computed as a float
 * amount: the costing replay averages prices over many cans and needs the
 * fractions. These two convert at the database boundary.
 *
 * `toCents` rounds half away from zero, like `roundCents` does for positive
 * amounts, so a price stored as cents is the price the app always stored.
 */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new RangeError(`Not an amount: ${amount}`);
  const cents = Math.round(Math.abs(amount) * 100);
  // `0 - cents` rather than `-cents`, which would store -0 for a negative fraction of a cent.
  return amount < 0 ? 0 - cents : cents;
}

/** The amount `cents` stands for; exact to the cent (k / 100 is the nearest double to it). */
export function fromCents(cents: number): number {
  return cents / 100;
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
