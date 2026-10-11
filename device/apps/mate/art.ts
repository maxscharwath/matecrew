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

const z = (x: number, y: number, s: number): string => `M${x} ${y}h${s}l${-s} ${s}h${s}`;

/**
 * Someone asleep in bed, a nightcap on, snoring Zs: the terminal outside the office's hours. Few
 * layers and one half tone, for a light screen. 200 × 125.
 */
export const Sleeper = createArt(
  [
    // The floor, the bed's ends and the mattress.
    { nodes: [["path", { d: "M4 112H196" }]], stroke: 2 },
    { nodes: [["rect", { x: 12, y: 44, width: 12, height: 68, rx: 5 }], ["rect", { x: 184, y: 62, width: 10, height: 50, rx: 4 }]], stroke: 2.5 },
    { nodes: [["rect", { x: 22, y: 78, width: 164, height: 16, rx: 4 }]], fill: true, tone: 0 },
    { nodes: [["rect", { x: 22, y: 78, width: 164, height: 16, rx: 4 }], ["path", { d: "M30 94V110M178 94V110" }]], stroke: 2.5 },
    // The pillow, then the head on it.
    { nodes: [["ellipse", { cx: 46, cy: 72, rx: 21, ry: 8 }]], fill: true, tone: 0 },
    { nodes: [["ellipse", { cx: 46, cy: 72, rx: 21, ry: 8 }]], stroke: 2.5 },
    { nodes: [["circle", { cx: 50, cy: 60, r: 13 }]], fill: true, tone: 0 },
    { nodes: [["circle", { cx: 50, cy: 60, r: 13 }]], stroke: 2.5 },
    // Closed eyes and a snoring mouth.
    { nodes: [["path", { d: "M42 61q3 2.5 6 0M53 61q3 2.5 6 0" }], ["circle", { cx: 51, cy: 67.5, r: 1.6 }]], stroke: 2 },
    // The nightcap: dithered, its band, its tail flopping onto the pillow, the pompom.
    { nodes: [["path", { d: "M37 57Q35 41 51 41Q61 42 63 53Q50 49 37 57Z" }], ["path", { d: "M44 45Q30 42 27 57" }]], fill: true, tone: 50 },
    { nodes: [["path", { d: "M37 57Q35 41 51 41Q61 42 63 53Q50 49 37 57Z" }], ["path", { d: "M44 45Q30 42 27 57" }]], stroke: 2.5 },
    // Its light band, where it meets the forehead.
    { nodes: [["path", { d: "M37 57Q50 49 63 53L62.5 48.5Q50 44.5 37.5 52.5Z" }]], fill: true, tone: 0 },
    { nodes: [["path", { d: "M37 57Q50 49 63 53L62.5 48.5Q50 44.5 37.5 52.5Z" }]], stroke: 2 },
    { nodes: [["circle", { cx: 27, cy: 59, r: 3.5 }]], fill: true },
    // The blanket over the body, half tone.
    {
      nodes: [["path", { d: "M58 90V71C66 62 80 58 96 58C116 58 128 64 144 63C160 62 172 60 182 62C188 64 188 72 188 90Z" }]],
      fill: true,
      tone: 50,
    },
    {
      nodes: [["path", { d: "M58 90V71C66 62 80 58 96 58C116 58 128 64 144 63C160 62 172 60 182 62C188 64 188 72 188 90Z" }]],
      stroke: 2.5,
    },
    // Zs rising from the sleeper, the second larger.
    { nodes: [["path", { d: `${z(70, 34, 8)}${z(86, 16, 12)}` }]], stroke: 2.5 },
  ],
  [0, 0, 200, 125],
);
