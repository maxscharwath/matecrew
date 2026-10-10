/**
 * How the panel shows a new frame, as `device/ui/src/frame.rs` decides on the terminal: nothing
 * flashes. An update is one partial refresh, a new screen two (one would leave the old screen
 * showing through); the terminal clears the ghosting with a full refresh only when idle.
 */

/** Share of the panel's pixels (percent) that makes a refresh a new screen. */
export const NEW_SCREEN_PERCENT = 6;
/** Share of the panel turned by partial refreshes since the last full one that calls for a full one, once idle. */
export const GHOST_PERCENT = 30;

const ONES = Uint8Array.from({ length: 256 }, (_, byte) => {
  let count = 0;
  for (let b = byte; b; b >>= 1) count += b & 1;
  return count;
});

/** Pixels that turn between two packed 1-bit frames. */
export function flipped(before: Uint8Array, after: Uint8Array): number {
  let turned = 0;
  for (let i = 0; i < after.length; i++) turned += ONES[(before[i] ?? 0) ^ after[i]];
  return turned;
}

const share = (pixels: number, width: number, height: number) => Math.floor((pixels * 100) / (width * height));

/** Partial refreshes for `turned` pixels of a `width` × `height` panel: two for a new screen. */
export function refreshPasses(turned: number, width: number, height: number): 1 | 2 {
  return share(turned, width, height) >= NEW_SCREEN_PERCENT ? 2 : 1;
}

/** Whether `ghost` pixels turned by partial refreshes call for a full one. */
export function worn(ghost: number, width: number, height: number): boolean {
  return share(ghost, width, height) >= GHOST_PERCENT;
}
