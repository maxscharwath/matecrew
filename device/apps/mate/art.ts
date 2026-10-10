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
