import { Image } from "../runtime/jsx-runtime";
import type { Element } from "../runtime/types";
import { rasterize, type Paint, type Sprite, type VectorNode } from "./vector";
export type IconProps = {
  x?: number;
  y?: number;
  size?: number;
  width?: number;
  height?: number;
  /** Vector icons only: line width in pixels (default 2, the Lucide weight at 24 px). */
  strokeWidth?: number;
  /** Paper-coloured, for an ink surface. */
  inverted?: boolean;
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
    inverted = false,
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
      inverted,
    });
  };
}

/**
 * A vector icon (Lucide's 24-unit grid), drawn at compile time at the size it is used, with a
 * stroke of exactly `strokeWidth` pixels. Sizes that are multiples of 24 land on whole pixels.
 */
export function createVectorIcon(nodes: VectorNode[]): IconComponent {
  const drawn = new Map<string, Sprite>();
  return ({ x = 0, y = 0, size = 24, width = size, height = size, strokeWidth = 2, inverted = false }) => {
    if (![width, height].every((value) => Number.isInteger(value) && value > 0))
      throw new Error("Icon dimensions must be positive integer pixels");
    if (!(strokeWidth > 0 && strokeWidth <= 16)) throw new Error("Icon strokeWidth must be in (0, 16] pixels");
    const side = Math.min(width, height);
    const key = `${side}:${strokeWidth}`;
    let sprite = drawn.get(key);
    if (!sprite) drawn.set(key, (sprite = rasterize([{ nodes, stroke: strokeWidth }], side)));
    return Image({
      x: x + Math.floor((width - side) / 2),
      y: y + Math.floor((height - side) / 2),
      width: side,
      height: side,
      sourceWidth: side,
      sourceHeight: side,
      value: sprite.bits,
      inverted,
    });
  };
}

/** One layer of an illustration: like `Paint`, but strokes in viewBox units so they scale. */
export type ArtLayer = Omit<Paint, "stroke"> & { stroke?: number };
/**
 * Multi-layer vector art (fills, dithered tones, strokes in viewBox units), drawn at compile time
 * at the size it is used. Later layers draw over earlier ones; tone 0 erases to paper.
 */
export function createArt(layers: ArtLayer[], viewBox: [number, number, number, number] = [0, 0, 24, 24]): IconComponent {
  const drawn = new Map<string, Sprite>();
  return ({ x = 0, y = 0, size, width, height, inverted = false }) => {
    // Given one side, the other follows the art's proportions.
    const w = width ?? size ?? (height !== undefined ? Math.round((height * viewBox[2]) / viewBox[3]) : viewBox[2]);
    const h = height ?? size ?? Math.round((w * viewBox[3]) / viewBox[2]);
    if (![w, h].every((value) => Number.isInteger(value) && value > 0))
      throw new Error("Art dimensions must be positive integer pixels");
    const key = `${w}x${h}`;
    let sprite = drawn.get(key);
    if (!sprite) {
      const scale = Math.min(w / viewBox[2], h / viewBox[3]);
      sprite = rasterize(layers.map((layer) => ({ ...layer, stroke: (layer.stroke ?? 0) * scale })), w, h, viewBox);
      drawn.set(key, sprite);
    }
    return Image({ x, y, width: w, height: h, sourceWidth: w, sourceHeight: h, value: sprite.bits, inverted });
  };
}
