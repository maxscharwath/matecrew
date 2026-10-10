/**
 * Design tokens of the native kit: an 800 × 480 one-bit panel seen from arm's length.
 * One pixel is 0.2 mm; the two touch keys sit under x = 130 and x = 670, the badge reader
 * under the centre.
 */
import type { Typography } from "../runtime/types";

export const SCREEN = { width: 800, height: 480 } as const;
/** Base unit: every gap is a multiple. */
export const UNIT = 8;
export const MARGIN = 32;
/** Physical controls under the panel, in panel pixels. */
export const KEYS = { left: 130, right: 670, reader: 400 } as const;
/** Status bar height, hairline included. */
export const STATUS = 56;
/** Top of the key tabs; the content area ends a unit above. */
export const TABS = 424;
/** The area between the status bar and the key tabs. */
export const CONTENT = { x: MARGIN, y: 72, width: 736, height: 336 } as const;
export const RADIUS = { card: 16, control: 12, pill: 28 } as const;
/** Ordered-dither tones, in percent of ink. */
export const TONE = { faint: 12, light: 25, medium: 50 } as const;

/** A text style with the metrics needed to place it on its cap height. */
export type TypeStyle = Typography & {
  /** Rect top to baseline. */
  ascent: number;
  /** Height of capitals (or figures). */
  cap: number;
  /** Line pitch, as the engine lays out several lines. */
  line: number;
};
const grotesk = (fontSize: Typography["fontSize"], bold: boolean, ascent: number, cap: number, line: number, letterSpacing?: number): TypeStyle => ({
  fontFamily: "grotesk",
  fontSize,
  fontWeight: bold ? "bold" : "normal",
  ...(letterSpacing ? { letterSpacing } : {}),
  ascent,
  cap,
  line,
});
const figures = (fontSize: Typography["fontSize"], ascent: number, cap: number, line: number): TypeStyle => ({
  fontFamily: "numeric",
  fontSize,
  ascent,
  cap,
  line,
});

/**
 * The type scale. Free Universal for words, Logisoso for figures. `figureL` and larger hold
 * digits and `+ - . , : /` only.
 */
export const TYPE = {
  /** Fine print: build stamps, legal lines. The smallest the panel reads at arm's length. */
  footnote: grotesk(11, false, 16, 11, 22),
  /** Spaced capitals above a value or a section; write the text in capitals. */
  label: grotesk(14, true, 21, 14, 28, 2),
  caption: grotesk(14, false, 21, 14, 28),
  captionStrong: grotesk(14, true, 21, 14, 28),
  body: grotesk(17, false, 24, 17, 32),
  strong: grotesk(17, true, 25, 17, 33),
  lead: grotesk(20, false, 28, 20, 37),
  leadStrong: grotesk(20, true, 29, 20, 38),
  title: grotesk(25, true, 37, 25, 48),
  headline: grotesk(30, true, 43, 30, 56),
  hero: grotesk(35, true, 52, 35, 67),
  display: grotesk(42, true, 62, 42, 79),
  figureXS: figures(24, 29, 24, 37),
  figureS: figures(32, 39, 32, 49),
  figure: figures(46, 56, 46, 70),
  figureM: figures(58, 70, 58, 87),
  figureL: figures(62, 70, 62, 76),
  figureXL: figures(78, 88, 78, 95),
  figureXXL: figures(92, 105, 92, 113),
} as const;
export type TypeName = keyof typeof TYPE;
