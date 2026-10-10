import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, verify } from "../src/token";
import { command, parse, type FromTerminal } from "../src/protocol";

const SECRET = "test-secret-not-a-real-one";

test("a token the site signs is accepted until it expires", async () => {
  const token = await sign(SECRET, { sub: "cmv-device", role: "device" }, 600, 1_000);
  assert.deepEqual(await verify(SECRET, token, 1_000), { sub: "cmv-device", role: "device", exp: 1_600 });
  assert.equal(await verify(SECRET, token, 1_600), null, "expired");
});

test("a token signed with another secret, altered or malformed is refused", async () => {
  const token = await sign(SECRET, { sub: "cmv-device", role: "console" }, 600, 1_000);
  assert.equal(await verify("other-secret", token, 1_000), null);
  const [body, mac] = token.split(".");
  const forged = `${btoa(JSON.stringify({ sub: "cmv-device", role: "site", exp: 9_999 })).replaceAll("=", "")}.${mac}`;
  assert.equal(await verify(SECRET, forged, 1_000), null);
  assert.equal(await verify(SECRET, `${body}.${mac}.x`, 1_000), null);
  assert.equal(await verify(SECRET, "garbage", 1_000), null);
});

test("frames parse by kind, and commands need an id and a kind", () => {
  assert.deepEqual(parse<FromTerminal>('{"t":"ack","id":"c1"}', ["ack"]), { t: "ack", id: "c1" });
  assert.equal(parse<FromTerminal>('{"t":"other"}', ["ack"]), null);
  assert.equal(parse<FromTerminal>("not json", ["ack"]), null);
  assert.deepEqual(command({ id: "c1", kind: "key", side: "left" }), { id: "c1", kind: "key", side: "left" });
  assert.equal(command({ kind: "key" }), null);
  assert.equal(command({ id: "c1", kind: "badge", uid: "x".repeat(2_000) }), null, "too big");
});
