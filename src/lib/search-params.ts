/**
 * Reads a repeated query parameter (`?user=a&user=b`) as a list of ids.
 *
 * Next.js hands a single occurrence over as a string and several as an array,
 * so multi-select filters normalise through here.
 */
export function toIdList(
  value: string | string[] | undefined,
): readonly string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter(Boolean);
}
