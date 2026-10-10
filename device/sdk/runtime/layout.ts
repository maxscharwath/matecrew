/**
 * Responsive sizes and flex layout, as engine/src/scene/layout.rs computes them on the device.
 * A size is pixels, `"hug"` (the content's size, the default), `"fill"` (the free space; with
 * `{ fill: n }` a weighted share) or a percentage of the parent (`"40%"`).
 */
import type { Layout } from "./types";

export type Dimension = number | "hug" | "fill" | `${number}%` | { fill: number };

const HUG = 0xfffe;
const FILL = 0xfe00;
const PERCENT = 0xfd00;
const MAX = 4096;

/** The code the engine reads in a rect's width or height. */
export function dim(value: Dimension | undefined, fallback: Dimension = "hug"): number {
  const v = value ?? fallback;
  if (typeof v === "number") {
    if (!Number.isInteger(v) || v < 0 || v > MAX) throw new Error(`Size must be 0–${MAX} whole pixels, "hug", "fill" or a percentage: ${v}`);
    return v;
  }
  if (v === "hug") return HUG;
  if (v === "fill") return FILL + 1;
  if (typeof v === "object") {
    if (!Number.isInteger(v.fill) || v.fill < 1 || v.fill > 255) throw new Error("fill weight must be 1–255");
    return FILL + v.fill;
  }
  const percent = Number(v.slice(0, -1));
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) throw new Error(`Percent sizes are whole 1–100%: ${v}`);
  return PERCENT + percent;
}
export function validDim(code: number): boolean {
  return (
    (Number.isInteger(code) && code >= 0 && code <= MAX) ||
    code === HUG ||
    (code > FILL && code <= FILL + 255) ||
    (code > PERCENT && code <= PERCENT + 100)
  );
}
/** A pixel size, if the dimension is one (for kit components that need arithmetic). */
export const px = (code: number): number | undefined => (code <= MAX ? code : undefined);

export type Align = "start" | "center" | "end" | "stretch";
export type Justify = "start" | "center" | "end" | "between" | "around" | "evenly";
/** `padding`: all sides, `[vertical, horizontal]` or `[top, right, bottom, left]`. */
export type Padding = number | [number, number] | [number, number, number, number];
export type LayoutProps = {
  /** Children as a flex line: `column` (default) or `row`. */
  direction?: "row" | "column";
  gap?: number;
  padding?: Padding;
  /** Cross axis; `stretch` (default) makes content-sized children span it. */
  align?: Align;
  justify?: Justify;
};

/** Top, right, bottom and left: one value for all four, or vertical and horizontal pairs. */
function sidesOf(p: Padding): [number, number, number, number] {
  if (typeof p === "number") return [p, p, p, p];
  return p.length === 2 ? [p[0], p[1], p[0], p[1]] : p;
}

/** The layout these props describe, or none when no layout prop is given. */
export function layoutOf(props: LayoutProps): Layout | undefined {
  const { direction, gap, padding, align, justify } = props;
  if ([direction, gap, padding, align, justify].every((v) => v === undefined)) return undefined;
  const sides = sidesOf(padding ?? 0);
  return {
    direction: direction ?? "column",
    align: align ?? "stretch",
    justify: justify ?? "start",
    gap: gap ?? 0,
    padding: sides,
  };
}
