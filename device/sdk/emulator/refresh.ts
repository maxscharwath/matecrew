/**
 * How the panel shows a new frame, as `device/ui/src/frame.rs` decides on the terminal: a new
 * screen takes the fast full refresh (a partial one would leave the old screen showing through),
 * an update stays partial, and partial refreshes add up to a full one.
 */

/** Share of the panel's pixels (percent) that makes a refresh a new screen. */
export const NEW_SCREEN_PERCENT = 6;
/** Share of the panel turned by partial refreshes since the last full one that calls for a full one. */
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

/** Full or partial for `turned` pixels of a `width` × `height` panel, `ghost` pixels already turned. */
export function refreshKind(turned: number, ghost: number, width: number, height: number): "full" | "partial" {
  const share = (pixels: number) => Math.floor((pixels * 100) / (width * height));
  return share(turned) >= NEW_SCREEN_PERCENT || share(ghost + turned) >= GHOST_PERCENT ? "full" : "partial";
}
