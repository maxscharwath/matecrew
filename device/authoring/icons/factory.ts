import { Image } from "../jsx-runtime";
import type { Element } from "../types";
export type IconProps = {
  x?: number;
  y?: number;
  size?: number;
  width?: number;
  height?: number;
};
export type IconComponent = (props: IconProps) => Element;
/** The imported component decodes its own sprite only when used during compilation. */
export function createIcon(
  sourceWidth: number,
  sourceHeight: number,
  hex: string,
): IconComponent {
  let bits: number[] | undefined;
  return ({
    x = 0,
    y = 0,
    size = sourceWidth,
    width = size,
    height = size,
  }) => {
    if (![width, height].every((value) => Number.isInteger(value) && value > 0))
      throw new Error("Icon dimensions must be positive integer pixels");
    bits ??= Array.from({ length: hex.length / 2 }, (_, i) =>
      parseInt(hex.slice(i * 2, i * 2 + 2), 16),
    );
    // Fit inside the requested box without stretching or unevenly magnifying source pixels.
    const ratio = Math.min(width / sourceWidth, height / sourceHeight);
    const scale = ratio >= 1 ? Math.floor(ratio) : 1 / Math.ceil(1 / ratio);
    const inkWidth = Math.max(1, Math.floor(sourceWidth * scale));
    const inkHeight = Math.max(1, Math.floor(sourceHeight * scale));
    return Image({
      x: x + Math.floor((width - inkWidth) / 2),
      y: y + Math.floor((height - inkHeight) / 2),
      width: inkWidth,
      height: inkHeight,
      sourceWidth,
      sourceHeight,
      value: bits,
    });
  };
}
