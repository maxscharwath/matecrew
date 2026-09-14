/**
 * The categorical hues an item can be pinned to, and the shape a pinned colour
 * has to take.
 *
 * Kept out of `chart-kit` so the items admin can offer the same swatches
 * without pulling chart.js into that page's bundle. These are the light-theme
 * slots of the chart palette, validated with the dataviz palette validator
 * against the app's card surfaces — a pinned colour is used as-is in both
 * themes, so the presets are the ones that survive either background.
 */
export const ITEM_COLOR_PRESETS = [
  "#2a78d6", // blue
  "#008300", // green
  "#e87ba4", // magenta
  "#eda100", // yellow
  "#1baf7a", // aqua
  "#eb6834", // orange
] as const;

/** `#rrggbb` — the shape an `<input type="color">` emits. */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}
