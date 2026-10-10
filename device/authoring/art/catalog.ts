/** Build-time lookup. Only the returned packed sprite is encoded into DUI1. */
import { packedIcons, type IconName } from "./generated";
import type { SpriteAsset } from "./raster";
export type { IconName } from "./generated";
export function catalogIcon(name: IconName): SpriteAsset {
  if (!Object.hasOwn(packedIcons, name))
    throw new Error(`Unknown device icon: ${name}`);
  const [width, height, hex] = packedIcons[name];
  return {
    width,
    height,
    bits: Array.from({ length: hex.length / 2 }, (_, i) =>
      parseInt(hex.slice(i * 2, i * 2 + 2), 16),
    ),
  };
}
