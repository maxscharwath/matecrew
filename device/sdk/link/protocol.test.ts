import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTRIBUTE_MAX,
  PROTOCOL,
  crc32,
  decodeEvent,
  decodeInfo,
  encodeCommand,
  encodeProvisioning,
  imageVersion,
  otaBegin,
  otaChunks,
  otaData,
} from "./protocol";
import { HttpRemote } from "./remote";

test("CRC-32 matches the standard check value, like the firmware's", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("OTA frames carry the layout the firmware parses", () => {
  const begin = otaBegin(1234, new Uint8Array(32).fill(7), "0.4.0");
  assert.equal(begin[0], 0x01);
  assert.equal(new DataView(begin.buffer).getUint32(1, true), 1234);
  assert.deepEqual([...begin.subarray(5, 37)], new Array(32).fill(7));
  assert.equal(new TextDecoder().decode(begin.subarray(37)), "0.4.0");

  const data = otaData(512, new TextEncoder().encode("firmware"));
  const view = new DataView(data.buffer);
  assert.equal(data[0], 0x02);
  assert.equal(view.getUint32(1, true), 512);
  assert.equal(view.getUint32(5, true), crc32(new TextEncoder().encode("firmware")));
  assert.equal(new TextDecoder().decode(data.subarray(9)), "firmware");
  assert.throws(() => otaBegin(1, new Uint8Array(31)));
});

test("an image is cut into in-order frames that each fit one attribute", () => {
  const image = Uint8Array.from({ length: 1300 }, (_, i) => i % 251);
  const frames = [...otaChunks(image, 500)];
  assert.deepEqual(frames.map((f) => f.offset), [0, 500, 1000]);
  assert.ok(frames.every((f) => f.frame.length <= ATTRIBUTE_MAX));
  const rebuilt = new Uint8Array(frames.flatMap((f) => [...f.frame.subarray(9)]));
  assert.deepEqual(rebuilt, image);
  assert.throws(() => [...otaChunks(image, 600)]);
});

test("provisioning and commands are checked as the device will", () => {
  const password = "p".repeat(8);
  const good = encodeProvisioning({ ssid: "Office", password, site: "https://x.test", secret: "abc" });
  assert.ok(good.ok);
  if (good.ok) assert.deepEqual(JSON.parse(new TextDecoder().decode(good.value)), { ssid: "Office", password, site: "https://x.test", secret: "abc" });
  assert.ok(encodeProvisioning({ ssid: "Open" }).ok, "an open network has no password");
  const short = encodeProvisioning({ ssid: "Office", password: "p".repeat(5) });
  assert.equal(short.ok ? null : short.error.code, "invalid");
  assert.equal(encodeProvisioning({ ssid: "x".repeat(33) }).ok, false);

  const key = encodeCommand({ cmd: "key", side: "left" });
  assert.ok(key.ok && new TextDecoder().decode(key.value) === '{"cmd":"key","side":"left"}');
  assert.equal(encodeCommand({ cmd: "badge", uid: "not hex!" }).ok, false);
  assert.equal(encodeCommand({ cmd: "notify", text: "" }).ok, false);
});

test("info and events decode, and a newer protocol is reported", () => {
  const info = decodeInfo(new TextEncoder().encode(JSON.stringify({ protocol: PROTOCOL, name: "d", networks: [] })));
  assert.ok(info.ok);
  const newer = decodeInfo(new TextEncoder().encode(JSON.stringify({ protocol: PROTOCOL + 1 })));
  assert.equal(newer.ok ? null : newer.error.code, "protocol");

  assert.deepEqual(decodeEvent(new TextEncoder().encode('{"t":"done","op":"setup","ok":true,"error":null}')), {
    t: "done",
    op: "setup",
    ok: true,
    error: null,
  });
  assert.equal(decodeEvent(new TextEncoder().encode('{"t":"future"}')), null);
  assert.equal(decodeEvent(new TextEncoder().encode("garbage")), null);
});

test("the version of an ESP-IDF image is read from its app descriptor", () => {
  const image = new Uint8Array(128);
  image[0] = 0xe9;
  new DataView(image.buffer).setUint32(32, 0xabcd5432, true);
  image.set(new TextEncoder().encode("0.4.0"), 48);
  assert.equal(imageVersion(image), "0.4.0");
  assert.equal(imageVersion(new Uint8Array(128)), null);
});

test("the HTTP remote posts the Bluetooth command shape and maps statuses", async () => {
  const calls: { url: string; body?: string; headers?: Record<string, string> }[] = [];
  const remote = new HttpRemote({
    baseUrl: "https://site.test/api/remote/abc/",
    headers: { "x-console": "test" },
    fetch: async (url, init) => {
      calls.push({ url, body: init?.body, headers: init?.headers });
      return url.endsWith("/commands")
        ? { ok: false, status: 501, text: async () => '{"error":"unsupported","message":"no both keys here"}' }
        : { ok: true, status: 200, text: async () => '{"name":"Terminal"}' };
    },
  });
  const sent = await remote.send({ cmd: "both" });
  assert.equal(calls[0].url, "https://site.test/api/remote/abc/commands");
  assert.equal(calls[0].body, '{"cmd":"both"}');
  assert.equal(calls[0].headers?.["x-console"], "test");
  assert.deepEqual(sent, { ok: false, error: { code: "unsupported", message: "no both keys here" } });
  assert.deepEqual(await remote.info(), { ok: true, value: { name: "Terminal" } });
});
