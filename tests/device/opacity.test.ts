import { test } from "node:test";
import assert from "node:assert/strict";
import { withOpacity } from "../../src/lib/device/bitmap";

/** 8 x 8 with a ring of ink from (2,2) to (5,5): its inside is the object, the rest around it. */
function ring() {
  const bits = new Uint8Array(8);
  for (let y = 2; y <= 5; y++)
    for (let x = 2; x <= 5; x++) if (y === 2 || y === 5 || x === 2 || x === 5) bits[y] |= 0x80 >> x;
  return { width: 8, height: 8, bits };
}

test("paper enclosed by ink is opaque, paper reachable from the edges is transparent", () => {
  const planes = withOpacity(ring());
  assert.equal(planes.length, 16);
  const opaque = (x: number, y: number) => (planes[8 + y] & (0x80 >> x)) !== 0;
  assert.equal(opaque(3, 3), true, "inside the ring: white");
  assert.equal(opaque(2, 2), true, "the ink itself");
  assert.equal(opaque(0, 0), false, "outside: transparent");
  assert.equal(opaque(7, 4), false);
  assert.deepEqual([...planes.slice(0, 8)], [...ring().bits], "the ink plane is unchanged");
});
