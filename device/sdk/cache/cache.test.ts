import { test } from "node:test";
import assert from "node:assert/strict";
import { Cache, DAY, DEFAULT_MAX_BYTES, HOUR, Keep, WEEK, key, localStorageBackend, memoryBackend, type CacheError } from ".";
import { crc32, fromBase64, toBase64, utf8Length } from "./entry";

type State = { office: string; stock: number[] };

const STATE = key<State>("state").keep(Keep.forever).maxBytes(1024);
const APP = key<Uint8Array>("app").keep(Keep.for(DAY)).maxBytes(64);
const NOTE = key<string>("note").keep(Keep.for(HOUR));

const OCT_10 = Date.UTC(2026, 9, 10);
const state = (): State => ({ office: "Lausanne", stock: [36, 12] });

/** A cache on a fresh memory backend with a clock the test moves, and what it reported. */
function setup() {
  const backend = memoryBackend();
  const clock = { now: OCT_10 as number | undefined };
  const reports: string[] = [];
  const writes = { count: 0 };
  const write = backend.write;
  backend.write = (name, entry) => {
    writes.count++;
    write(name, entry);
  };
  const cache = Cache.open(backend, {
    clock: () => clock.now,
    onError: (error: CacheError) => reports.push(error.message),
  });
  return { cache, backend, clock, reports, writes };
}

test("CRC-32 matches the standard check value, like the firmware's", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("sizes are UTF-8 bytes and bytes survive base64", () => {
  for (const text of ["", "maté", "Gen\u00e8ve \u{1F9C9}", "\ud800 lone"])
    assert.equal(utf8Length(text), new TextEncoder().encode(text).length, text);
  const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
});

test("a value reads back as it was put", () => {
  const { cache, backend, reports } = setup();
  assert.equal(cache.get(STATE), undefined);
  assert.deepEqual(cache.put(STATE, state()), { ok: true });
  assert.deepEqual(cache.get(STATE), state());
  cache.put(APP, new Uint8Array([0x44, 0x55, 0x49, 0x31, 0, 1]));
  assert.deepEqual(cache.get(APP), new Uint8Array([0x44, 0x55, 0x49, 0x31, 0, 1]));
  // Bytes go as base64, not as a JSON array.
  assert.match(backend.entries.get("app")!, /\nRFVJMQAB$/);
  cache.forget(STATE);
  assert.equal(cache.get(STATE), undefined);
  assert.deepEqual(reports, []);
});

test("keys are typed", () => {
  const { cache } = setup();
  // Checked by `tsc -p device`, not run.
  const misuse = () => {
    // @ts-expect-error: a note is a string.
    cache.put(NOTE, 42);
    // @ts-expect-error: and reads as one.
    const count: number | undefined = cache.get(NOTE);
    return count;
  };
  assert.equal(typeof misuse, "function");
  const note: string | undefined = cache.get(NOTE);
  assert.equal(note, undefined);
});

test("an entry expires after its keep and is removed", () => {
  const { cache, backend, clock, reports } = setup();
  cache.put(NOTE, "hello");
  clock.now = OCT_10 + HOUR - 1;
  assert.equal(cache.get(NOTE), "hello");
  clock.now = OCT_10 + HOUR;
  assert.equal(cache.get(NOTE), undefined);
  assert.equal(backend.entries.has("note"), false);
  // Expiring is not an error.
  assert.deepEqual(reports, []);
});

test("nothing expires while the clock is not set", () => {
  const { cache, clock } = setup();
  cache.put(NOTE, "hello");
  clock.now = 40_000;
  assert.equal(cache.get(NOTE), "hello");
  clock.now = undefined;
  assert.equal(cache.get(NOTE), "hello");
});

test("an entry written before the clock was set keeps from the first read with one", () => {
  const { cache, clock } = setup();
  clock.now = 12_000;
  cache.put(NOTE, "early");
  assert.deepEqual(cache.usage().entries[0].expires, { pending: HOUR });
  const later = OCT_10 + 5 * DAY;
  clock.now = later;
  assert.equal(cache.get(NOTE), "early");
  assert.equal(cache.usage().entries[0].written, later);
  clock.now = later + HOUR - 1;
  assert.equal(cache.get(NOTE), "early");
  clock.now = later + HOUR;
  assert.equal(cache.get(NOTE), undefined);
});

test("a clock that went back keeps the entry", () => {
  const { cache, clock } = setup();
  cache.put(NOTE, "hello");
  clock.now = OCT_10 - DAY;
  assert.equal(cache.get(NOTE), "hello");
});

test("a shorter keep in a newer key applies to older entries", () => {
  const { cache, clock } = setup();
  cache.put(key<string>("note").keep(Keep.for(WEEK)), "hello");
  clock.now = OCT_10 + 2 * HOUR;
  assert.equal(cache.get(NOTE), undefined);
});

test("a damaged entry reads as missing, is removed and reported", () => {
  const { cache, backend, reports } = setup();
  cache.put(STATE, state());
  backend.entries.set("state", backend.entries.get("state")!.replace("36", "37"));
  assert.equal(cache.get(STATE), undefined);
  assert.equal(backend.entries.has("state"), false);
  assert.deepEqual(reports.splice(0), ["bad checksum"]);
  cache.put(STATE, state());
  backend.entries.set("state", backend.entries.get("state")!.slice(0, -4));
  assert.equal(cache.get(STATE), undefined);
  assert.deepEqual(reports.splice(0), ["bad checksum"]);
});

test("an entry in another format or version reads as missing", () => {
  const { cache, backend, reports } = setup();
  // A bare value, without the header.
  backend.entries.set("state", '{"office":"Lausanne","stock":[36]}');
  assert.equal(cache.get(STATE), undefined);
  backend.entries.set("note", "showcase");
  assert.equal(cache.get(NOTE), undefined);
  assert.deepEqual(reports.splice(0), ["not a cache entry", "not a cache entry"]);
  cache.put(STATE, state());
  assert.equal(cache.get(STATE.version(2)), undefined);
  assert.deepEqual(reports.splice(0), ["another version"]);
});

test("a value over its limit is refused and the old one stays", () => {
  const { cache } = setup();
  cache.put(APP, new Uint8Array(64).fill(1));
  const refused = cache.put(APP, new Uint8Array(65).fill(2));
  assert.deepEqual(refused, { ok: false, error: { code: "too-large", key: "app", message: "app: 65 bytes, over its 64" } });
  assert.deepEqual(cache.get(APP), new Uint8Array(64).fill(1));
  // Not JSON.
  assert.equal(cache.put(key<undefined>("nothing"), undefined).ok, false);
});

test("keys keep a small default", () => {
  const SMALL = key<string>("small");
  assert.equal(SMALL.limit, DEFAULT_MAX_BYTES);
  assert.deepEqual(SMALL.kept, Keep.for(DAY));
  const { cache } = setup();
  const refused = cache.put(SMALL, "x".repeat(DEFAULT_MAX_BYTES));
  assert.equal(!refused.ok && refused.error.code, "too-large");
});

test("the same value again is not written, unless half its keep has passed", () => {
  const { cache, clock, writes } = setup();
  cache.put(STATE, state());
  cache.put(STATE, state());
  assert.equal(writes.count, 1);
  cache.put(STATE, { ...state(), office: "Genève" });
  assert.equal(writes.count, 2);
  cache.put(NOTE, "hello");
  clock.now = OCT_10 + HOUR / 2 - 1;
  cache.put(NOTE, "hello");
  assert.equal(writes.count, 3);
  clock.now = OCT_10 + HOUR / 2;
  cache.put(NOTE, "hello");
  assert.equal(writes.count, 4);
  clock.now = OCT_10 + HOUR + 1;
  assert.equal(cache.get(NOTE), "hello");
});

test("remember computes once, and returns what it cannot keep", async () => {
  const { cache, reports } = setup();
  let calls = 0;
  const compute = async () => (calls++, "computed");
  assert.equal(await cache.remember(NOTE, compute), "computed");
  assert.equal(await cache.remember(NOTE, compute), "computed");
  assert.equal(calls, 1);
  await assert.rejects(cache.remember(key<string>("other"), () => Promise.reject(new Error("offline"))), /offline/);
  assert.deepEqual(await cache.remember(APP, () => new Uint8Array(100)), new Uint8Array(100));
  assert.equal(cache.get(APP), undefined);
  assert.deepEqual(reports, ["app: 100 bytes, over its 64"]);
});

test("usage says what is cached, for how long and how big", () => {
  const { cache, clock } = setup();
  cache.put(STATE, state());
  cache.put(APP, new Uint8Array(48));
  cache.put(NOTE, "hello");
  clock.now = OCT_10 + HOUR / 2;
  const usage = cache.usage();
  assert.equal(usage.total, undefined);
  assert.equal(usage.now, OCT_10 + HOUR / 2);
  assert.deepEqual(Object.fromEntries(usage.entries.map(({ key, expires }) => [key, expires])), {
    state: "never",
    note: { at: OCT_10 + HOUR },
    app: { at: OCT_10 + DAY },
  });
  assert.equal(usage.used, usage.entries.reduce((sum, e) => sum + e.bytes, 0));
  for (let i = 1; i < usage.entries.length; i++) assert.ok(usage.entries[i - 1].bytes >= usage.entries[i].bytes);
});

test("clear removes every entry", () => {
  const { cache, backend } = setup();
  cache.put(STATE, state());
  cache.put(NOTE, "hello");
  backend.entries.set("stray", "value");
  cache.clear();
  assert.deepEqual(backend.names(), []);
});

test("localStorage entries live under a prefix, and blocked storage does not throw on read", () => {
  const items = new Map<string, string>();
  const storage = {
    get length() {
      return items.size;
    },
    key: (i: number) => [...items.keys()][i] ?? null,
    getItem: (name: string) => items.get(name) ?? null,
    setItem: (name: string, value: string) => void items.set(name, value),
    removeItem: (name: string) => void items.delete(name),
    clear: () => items.clear(),
  } satisfies Storage;
  items.set("other", "kept");
  const cache = Cache.open(localStorageBackend({ prefix: "dui:", storage }));
  cache.put(NOTE, "hello");
  assert.deepEqual([...items.keys()].sort(), ["dui:note", "other"]);
  assert.equal(cache.get(NOTE), "hello");
  assert.deepEqual(cache.usage().entries.map((e) => e.key), ["note"]);

  const blocked = {
    ...storage,
    getItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("quota", "QuotaExceededError");
    },
  } satisfies Storage;
  const errors: string[] = [];
  const offline = Cache.open(localStorageBackend({ storage: blocked }), { onError: (e) => errors.push(e.code) });
  assert.equal(offline.get(NOTE), undefined);
  const refused = offline.put(NOTE, "hello");
  assert.equal(!refused.ok && refused.error.code, "backend");
});
