/** Illustrations of the maté screens, drawn at compile time like the icons (see createArt). */
import { createArt } from "@matecrew/device-ui";

const card = { x: 30, y: 8, width: 60, height: 38, rx: 6, transform: "rotate(-10 60 27)" };

/** A staff badge hovering over the reader, contactless waves in between. 120 × 100. */
export const BadgeOverReader = createArt(
  [
    // The reader: a dithered pad, as the eye finds it under the screen.
    { nodes: [["rect", { x: 14, y: 82, width: 92, height: 12, rx: 6 }]], fill: true, tone: 25 },
    { nodes: [["rect", { x: 14, y: 82, width: 92, height: 12, rx: 6 }]], stroke: 2 },
    {
      nodes: [
        ["path", { d: "M47 72a18 18 0 0 1 26 0" }],
        ["path", { d: "M40 65a28 28 0 0 1 40 0" }],
        ["path", { d: "M54 79a8 8 0 0 1 12 0" }],
      ],
      stroke: 3,
    },
    // The badge, on paper so the waves pass behind it.
    { nodes: [["rect", card]], fill: true, tone: 0 },
    {
      nodes: [
        ["rect", card],
        ["circle", { cx: 45, cy: 28, r: 6, transform: "rotate(-10 60 27)" }],
        ["path", { d: "M57 23h20M57 31h13", transform: "rotate(-10 60 27)" }],
      ],
      stroke: 3,
    },
  ],
  [0, 0, 120, 100],
);

/**
 * The lit part of a disc (`cx`, `cy`, `r`) that a second disc (`bx`, `by`, `br`) bites into: a
 * crescent, as a polygon fine enough to rasterize smoothly. The bite must cross the disc's edge.
 */
function crescent(cx: number, cy: number, r: number, bx: number, by: number, br: number): string {
  const d = Math.hypot(bx - cx, by - cy);
  const toBite = Math.atan2(by - cy, bx - cx);
  const toMoon = Math.atan2(cy - by, cx - bx);
  // Half-angles of the two intersection points, seen from each centre.
  const alpha = Math.acos((d * d + r * r - br * br) / (2 * d * r));
  const beta = Math.acos((d * d + br * br - r * r) / (2 * d * br));
  const steps = 96;
  const points: [number, number][] = [];
  // The moon's edge the long way round, away from the bite...
  for (let i = 0; i <= steps; i++) {
    const a = toBite + alpha + ((2 * Math.PI - 2 * alpha) * i) / steps;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  // ... then back along the bite's edge, inside the moon, from where that ended.
  for (let i = 0; i <= steps; i++) {
    const a = toMoon + beta - (2 * beta * i) / steps;
    points.push([bx + br * Math.cos(a), by + br * Math.sin(a)]);
  }
  const corners = points.map(([x, y]) => x.toFixed(2) + " " + y.toFixed(2));
  return `M${corners.join("L")}Z`;
}

/** A four-pointed sparkle at (x, y), `s` from its centre to each point, its sides curving in. */
const sparkle = (x: number, y: number, s: number): string => {
  const k = s * 0.14;
  return `M${x} ${y - s}Q${x + k} ${y - k} ${x + s} ${y}Q${x + k} ${y + k} ${x} ${y + s}Q${x - k} ${y + k} ${x - s} ${y}Q${x - k} ${y - k} ${x} ${y - s}Z`;
};

const MOON = { x: 180, y: 150, r: 80 };

/**
 * The night sky outside the office's hours: a crescent moon, its dark side faintly lit, in a
 * dithered glow that fades out in two steps, a paper gap setting it apart, and a few sparkles.
 * Fills only, no hairlines: a partial refresh renders it cleanly. 360 × 300.
 */
export const NightSky = createArt(
  [
    // The glow: 6 % then 12 % of ink, closer to the moon.
    { nodes: [["circle", { cx: MOON.x, cy: MOON.y, r: 138 }]], fill: true, tone: 6 },
    { nodes: [["circle", { cx: MOON.x, cy: MOON.y, r: 110 }]], fill: true, tone: 12 },
    // A ring of paper around the moon, then its dark side, earthshine.
    { nodes: [["circle", { cx: MOON.x, cy: MOON.y, r: MOON.r + 9 }]], fill: true, tone: 0 },
    { nodes: [["circle", { cx: MOON.x, cy: MOON.y, r: MOON.r }]], fill: true, tone: 25 },
    // The lit crescent, the bite from the upper right.
    { nodes: [["path", { d: crescent(MOON.x, MOON.y, MOON.r, MOON.x + 40, MOON.y - 30, 74) }]], fill: true },
    // Sparkles and specks, outside the glow.
    {
      nodes: [
        ["path", { d: sparkle(42, 52, 17) }],
        ["path", { d: sparkle(322, 44, 11) }],
        ["path", { d: sparkle(328, 252, 15) }],
        ["path", { d: sparkle(36, 240, 8) }],
        ["circle", { cx: 100, cy: 18, r: 3 }],
        ["circle", { cx: 272, cy: 286, r: 3 }],
        ["circle", { cx: 350, cy: 150, r: 2.5 }],
        ["circle", { cx: 12, cy: 140, r: 2.5 }],
      ],
      fill: true,
    },
  ],
  [0, 0, 360, 300],
);
