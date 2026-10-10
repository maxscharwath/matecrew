/**
 * Name lookups for the MCP tools, where a model passes the name a person said.
 *
 * Matched in code rather than SQL: SQLite compares text case-sensitively and
 * its LIKE folds ASCII letters only ("MATÉ" would not find "Maté"), while the
 * candidate lists here (an office's items, the offices) are short.
 */

/** True when the two names are equal ignoring case and surrounding spaces. */
export function sameName(name: string, wanted: string): boolean {
  return name.trim().toLowerCase() === wanted.trim().toLowerCase();
}

/** The row whose id is `wanted`, or else the first whose name matches it ignoring case. */
export function findByIdOrName<T extends { readonly id: string; readonly name: string }>(
  rows: readonly T[],
  wanted: string,
): T | undefined {
  const key = wanted.trim();
  return rows.find((row) => row.id === key) ?? rows.find((row) => sameName(row.name, key));
}
