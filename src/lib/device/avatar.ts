/**
 * People on the terminal: their avatar dithered in a disc, as the screens that name someone draw
 * it ("Mon compte", "Servi", the preparation). Only the live answers and the people a preparation
 * concerns carry one: the badges in the state stay names.
 *
 * Decoding a photo costs a transformation (Cloudflare Images), so each avatar's grey levels are
 * worked out the first time a terminal needs them and kept in storage next to it; every side is
 * then drawn from them here, without decoding anything.
 */
import { platform, readBlobBytes } from "@/platform";
import { blank, dither, set } from "@/lib/device/bitmap";

/** Sides of a person's picture in panel pixels, as each screen draws it (`device/core` contract). */
export const AVATAR_SIDE = {
  /** "Mon compte" and "Mes achats": before the title. */
  account: 40,
  /** "Servi": the runner, in place of the icon. */
  served: 128,
  /** The preparation: each person on an order's card. */
  preparation: 32,
} as const;

/** Grey levels kept per avatar, the largest side a screen draws: the others are averaged down. */
export const GREY_SIDE = 128;
/** A very long picture is not decoded larger than this to fill the disc; its ends stay white. */
const MAX_DECODED_SIDE = 4 * GREY_SIDE;

/**
 * `image`'s picture at `side` x `side`, packed 1-bit then its opacity plane (a disc), base64: the
 * face dithered, ringed in ink, transparent around. Null without an avatar, or one that cannot be
 * read (logged): the screen then shows the initials or an icon.
 */
export async function avatarPicture(
  userId: string,
  image: string | null | undefined,
  side: number,
): Promise<string | null> {
  if (!image || !readable(image)) return null;
  try {
    const grey = await avatarGrey(userId, image);
    return grey && Buffer.from(avatarPlanes(grey, side)).toString("base64");
  } catch (error) {
    console.error(`[device] avatar of ${userId} failed`, error);
    return null;
  }
}

/**
 * What a screen shows for someone without an avatar: the first letters of their first and last
 * names, "AM" for Alex Martin (`device/ui` does the same from the account's name).
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (word: string | undefined) => Array.from(word ?? "")[0] ?? "";
  return (first(words[0]) + (words.length > 1 ? first(words.at(-1)) : "")).toUpperCase();
}

/** Where an avatar's grey levels are kept: beside it, named after the picture they come from. */
export async function avatarGreyKey(userId: string, image: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(image)));
  const hash = Array.from(digest.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  return `avatars/${userId}/terminal-${hash}.grey`;
}

/** The avatar in grey levels at GREY_SIDE, kept the first time; null when there is none to read. */
async function avatarGrey(userId: string, image: string): Promise<Uint8Array | null> {
  const key = await avatarGreyKey(userId, image);
  const kept = await platform.storage.get(key);
  if (kept) {
    const grey = await readBlobBytes(kept);
    if (grey.length === GREY_SIDE * GREY_SIDE) return grey;
  }
  const bytes = await avatarBytes(image);
  if (!bytes) return null;
  const grey = await coverGrey(bytes);
  platform.runInBackground(
    platform.storage.put(key, grey, { contentType: "application/octet-stream" }),
    "terminal avatar",
  );
  return grey;
}

/**
 * Whether the terminal can show this avatar: uploaded on the profile (`avatars/` in storage) or
 * given by Microsoft at sign-in (a base64 `data:` URL). An address elsewhere is not fetched:
 * anyone can set one.
 */
function readable(image: string): boolean {
  const comma = image.indexOf(",");
  return image.startsWith("avatars/") || (image.startsWith("data:image/") && image.slice(0, comma).endsWith(";base64"));
}

/** The avatar's bytes, `readable` as it is; null when its file is gone. */
async function avatarBytes(image: string): Promise<Uint8Array | null> {
  if (image.startsWith("avatars/")) {
    const blob = await platform.storage.get(image);
    return blob && readBlobBytes(blob);
  }
  // Base64 decoding skips the space Microsoft's URLs have after the comma.
  return new Uint8Array(Buffer.from(image.slice(image.indexOf(",") + 1), "base64"));
}

/**
 * The picture filling a GREY_SIDE square, as a disc crops it: `greyscaleSquare` fits the whole
 * picture in its square, so it is asked large enough for the short side to be GREY_SIDE, and the
 * square is cut from the middle (from the upper third of a portrait, where the face is).
 */
async function coverGrey(bytes: Uint8Array): Promise<Uint8Array> {
  const { width, height } = await platform.images.size(bytes);
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (short <= 0) throw new Error("An avatar without pixels");
  const side = Math.min(MAX_DECODED_SIDE, Math.round((GREY_SIDE * long) / short));
  const grey = await platform.images.greyscaleSquare(bytes, side, "lanczos3");
  const spare = side - GREY_SIDE;
  const left = spare >> 1;
  const top = height > width ? Math.round(spare / 3) : spare >> 1;
  const out = new Uint8Array(GREY_SIDE * GREY_SIDE);
  for (let y = 0; y < GREY_SIDE; y++) {
    out.set(grey.subarray((top + y) * side + left, (top + y) * side + left + GREY_SIDE), y * GREY_SIDE);
  }
  return out;
}

/** The grey levels at `side`, each pixel the mean of the block of GREY_SIDE pixels it covers. */
function averaged(grey: Uint8Array, side: number): Uint8Array {
  const out = new Uint8Array(side * side);
  const edge = (n: number) => Math.round((n * GREY_SIDE) / side);
  for (let y = 0; y < side; y++) {
    const [y0, y1] = [edge(y), Math.max(edge(y + 1), edge(y) + 1)];
    for (let x = 0; x < side; x++) {
      const [x0, x1] = [edge(x), Math.max(edge(x + 1), edge(x) + 1)];
      let sum = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) sum += grey[sy * GREY_SIDE + sx];
      out[y * side + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return out;
}

/** Stretches the levels inside the disc so that its 1st and 99th percentiles become black and white. */
function stretched(grey: Uint8Array, inside: (i: number) => boolean): Uint8Array {
  const levels = Array.from(grey).filter((_, i) => inside(i)).sort((a, b) => a - b);
  const low = levels[Math.floor(levels.length * 0.01)] ?? 0;
  const high = levels[Math.ceil(levels.length * 0.99) - 1] ?? 255;
  if (high <= low) return grey;
  return grey.map((level) => Math.max(0, Math.min(255, Math.round(((level - low) * 255) / (high - low)))));
}

/**
 * Grey levels at GREY_SIDE (the kept ones) as the disc the terminal draws at `side`: the face
 * dithered inside, a ring of ink on its edge, the corners transparent.
 */
export function avatarPlanes(grey: Uint8Array, side: number): Uint8Array {
  const radius = side / 2;
  const ring = side > 48 ? 2 : 1;
  const distance = (i: number) => Math.hypot((i % side) + 0.5 - radius, Math.floor(i / side) + 0.5 - radius);
  const inside = (i: number) => distance(i) <= radius;
  const face = dither(stretched(averaged(grey, side), inside), side, side);
  const ink = blank(side, side);
  const opacity = blank(side, side);
  for (let i = 0; i < side * side; i++) {
    if (!inside(i)) continue;
    const [x, y] = [i % side, Math.floor(i / side)];
    set(opacity, x, y);
    const inked = (face.bits[i >> 3] & (0x80 >> (i & 7))) !== 0;
    if (inked || distance(i) > radius - ring) set(ink, x, y);
  }
  const planes = new Uint8Array(ink.bits.length * 2);
  planes.set(ink.bits);
  planes.set(opacity.bits, ink.bits.length);
  return planes;
}
