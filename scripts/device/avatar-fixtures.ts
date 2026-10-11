/**
 * The terminal previews' avatars: drawn busts, nobody real, dithered by the site's own code
 * (`src/lib/device/avatar.ts`) at each side a screen draws. From the repository's root:
 *
 *   bun scripts/device/avatar-fixtures.ts
 *
 * writes `device/fixtures/avatars.json`, which `device/ui/src/previews.rs` reads.
 */
import { writeFile } from "node:fs/promises";
import { AVATAR_SIDE, GREY_SIDE, avatarPlanes } from "@/lib/device/avatar";

type Bust = { wall: number; skin: number; hair: number; longHair?: boolean; glasses?: boolean };

/** How far (x, y) is inside the ellipse: 1 on its edge. */
const ellipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;

/** The wall, the jumper and the neck at (x, y). */
function body(b: Bust, x: number, y: number): number {
  const shoulders = ellipse(x, y, 64, 150, 62, 48);
  if (Math.abs(x - 64) < 11 && y > 80 && y < 112) return b.skin - 75 - 25 * (x / GREY_SIDE);
  if (shoulders <= 1) return 70 + 50 * (1 - x / GREY_SIDE) - 20 * shoulders;
  return b.wall + (x / GREY_SIDE) * 30 - (y / GREY_SIDE) * 20;
}

/** The head over `under`: long hair behind, the face lit from the left, the hair on top. */
function head(b: Bust, x: number, y: number, under: number): number {
  const face = ellipse(x, y, 64, 60, 25, 31);
  const top = ellipse(x, y, 64, 47, 29, 24);
  if (top <= 1 && (y < 42 + (x - 40) * 0.15 || face > 1)) return b.hair + 25 * top;
  if (face <= 1) return b.skin - 60 * Math.max(0, (x - 52) / 40) - 25 * face;
  if (b.longHair && ellipse(x, y, 64, 70, 33, 40) <= 1) return b.hair + 20;
  return under;
}

/** Eyebrows, eyes (and glasses), the nose's shade and the mouth over `under`. */
function features(b: Bust, x: number, y: number, under: number): number {
  let v = under;
  for (const ex of [53, 75]) {
    if (ellipse(x, y, ex, 53, 6, 1.6) <= 1) v = b.hair + 15;
    if (ellipse(x, y, ex, 60, 3.6, 2.4) <= 1) v = 35;
    if (b.glasses && Math.abs(ellipse(x, y, ex, 60, 8, 6.5) - 1) < 0.25) v = 30;
  }
  if (ellipse(x, y, 67, 70, 2.5, 7) <= 1) v -= 30;
  if (ellipse(x, y, 64, 81, 8, 2) <= 1) v = b.skin - 130;
  return v;
}

/** A bust in grey levels at GREY_SIDE: wall, jumper, neck, face and hair, lit from the left. */
function bust(b: Bust): Uint8Array {
  return Uint8Array.from({ length: GREY_SIDE * GREY_SIDE }, (_, i) => {
    const [x, y] = [i % GREY_SIDE, Math.floor(i / GREY_SIDE)];
    const v = features(b, x, y, head(b, x, y, body(b, x, y)));
    return Math.max(0, Math.min(255, Math.round(v)));
  });
}

const BUSTS: Bust[] = [
  { wall: 150, skin: 225, hair: 45 },
  { wall: 200, skin: 215, hair: 70, longHair: true },
  { wall: 120, skin: 175, hair: 30, glasses: true },
];

const picture = (b: Bust, side: number) => Buffer.from(avatarPlanes(bust(b), side)).toString("base64");

const fixtures = {
  account: picture(BUSTS[0], AVATAR_SIDE.account),
  served: picture(BUSTS[0], AVATAR_SIDE.served),
  preparation: BUSTS.map((b) => picture(b, AVATAR_SIDE.preparation)),
};
await writeFile(new URL("../../device/fixtures/avatars.json", import.meta.url), `${JSON.stringify(fixtures, null, 2)}\n`);
