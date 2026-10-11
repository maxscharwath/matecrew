import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { platform } from "../../src/platform/node";
import { createFileBlobStore } from "../../src/platform/node/storage";
import { settleBackground } from "../../src/platform/node/background";
import { AVATAR_SIDE, GREY_SIDE, avatarGreyKey, avatarPicture, avatarPlanes, initials } from "../../src/lib/device/avatar";

const bit = (plane: Uint8Array, side: number, x: number, y: number) => (plane[(y * side + x) >> 3] & (0x80 >> ((y * side + x) & 7))) !== 0;

test("an avatar is a disc: the face dithered inside, ringed in ink, transparent around", () => {
  const side = AVATAR_SIDE.account;
  // A face lit from the left: a gradient, whose middle tones dithering has to draw.
  const grey = Uint8Array.from({ length: GREY_SIDE * GREY_SIDE }, (_, i) => Math.round(((i % GREY_SIDE) / GREY_SIDE) * 255));
  const planes = avatarPlanes(grey, side);
  const bytes = (side * side) / 8;
  assert.equal(planes.length, 2 * bytes);
  const [ink, opacity] = [planes.subarray(0, bytes), planes.subarray(bytes)];
  assert.equal(bit(opacity, side, 0, 0), false, "a corner is transparent");
  assert.equal(bit(ink, side, 0, 0), false);
  assert.equal(bit(opacity, side, side / 2, side / 2), true, "the middle is opaque");
  assert.equal(bit(ink, side, side / 2, 0), true, "the ring at the top");
  assert.equal(bit(ink, side, 0, side / 2), true, "and on the left");
  // Inside the ring, the middle column is a mid grey: dots, neither black nor white.
  let inked = 0;
  for (let y = 8; y < side - 8; y++) for (let x = side / 2 - 2; x < side / 2 + 2; x++) if (bit(ink, side, x, y)) inked++;
  const share = inked / ((side - 16) * 4);
  assert.ok(share > 0.2 && share < 0.8, `${share}`);
});

test("someone without an avatar shows their initials", () => {
  assert.equal(initials("Alex Martin"), "AM");
  assert.equal(initials("  jean-pierre   de la Fontaine "), "JF");
  assert.equal(initials("Lou"), "L");
  assert.equal(initials("élodie"), "É");
  assert.equal(initials(""), "");
});

test("an avatar is decoded once, then drawn from the grey levels kept in storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "matecrew-avatars-"));
  const { storage, images } = platform;
  const decoded: number[] = [];
  Object.assign(platform, {
    storage: createFileBlobStore(root),
    images: { ...images, greyscaleSquare: (...args: Parameters<typeof images.greyscaleSquare>) => (decoded.push(args[1]), images.greyscaleSquare(...args)) },
  });
  try {
    // As Microsoft gives it at sign-in: a 48 x 48 JPEG in a data URL, a space after the comma.
    const jpeg = await sharp({ create: { width: 48, height: 48, channels: 3, background: "#808080" } }).jpeg().toBuffer();
    const image = `data:image/jpeg;base64, ${jpeg.toString("base64")}`;
    const first = await avatarPicture("u1", image, AVATAR_SIDE.preparation);
    assert.ok(first);
    assert.equal(Buffer.from(first, "base64").length, 2 * ((32 * 32) / 8));
    await settleBackground();
    assert.ok(await platform.storage.head(await avatarGreyKey("u1", image)), "the grey levels are kept");
    // Another side, another screen: nothing decoded again.
    assert.ok(await avatarPicture("u1", image, AVATAR_SIDE.served));
    assert.deepEqual(decoded, [GREY_SIDE]);
  } finally {
    Object.assign(platform, { storage, images });
    await rm(root, { recursive: true, force: true });
  }
});

test("no avatar, or one at an address elsewhere: nothing fetched, the screen shows initials", async () => {
  const original = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    throw new Error("no fetch");
  }) as unknown as typeof fetch;
  try {
    assert.equal(await avatarPicture("u1", null, AVATAR_SIDE.account), null);
    assert.equal(await avatarPicture("u1", "https://example.com/me.jpg", AVATAR_SIDE.account), null);
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = original;
  }
});
