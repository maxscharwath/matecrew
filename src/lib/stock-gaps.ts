/**
 * A stock count's arithmetic, with no database behind it — the count sheet is a
 * client component and shows the running gap as you type, so importing the
 * module that writes the count would drag Prisma into the browser bundle.
 */

/** countedQty - expectedQty: negative is shrinkage, positive a surplus. */
export function gapOf(expectedQty: number, countedQty: number): number {
  return countedQty - expectedQty;
}

/** Cans missing and cans found, from any list of counted lines. */
export function summarizeGaps(lines: { delta: number }[]): {
  missing: number;
  surplus: number;
} {
  let missing = 0;
  let surplus = 0;
  for (const line of lines) {
    if (line.delta < 0) missing -= line.delta;
    else surplus += line.delta;
  }
  return { missing, surplus };
}
