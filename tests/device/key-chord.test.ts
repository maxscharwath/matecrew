import { describe, expect, test } from "bun:test";
import { KeyChord, LONG_MS, type KeyPress, type Later } from "@/components/device-console/key-chord";

/** A clock the test moves by hand. */
function chord() {
  const pressed: KeyPress[] = [];
  let now = 0;
  const timers = new Set<{ at: number; run: () => void }>();
  const later: Later = (run, ms) => {
    const timer = { at: now + ms, run };
    timers.add(timer);
    return () => timers.delete(timer);
  };
  const keys = new KeyChord((key) => pressed.push(key), later);
  const wait = (ms: number) => {
    now += ms;
    for (const timer of [...timers].filter((t) => t.at <= now)) {
      timers.delete(timer);
      timer.run();
    }
  };
  return { keys, pressed, wait };
}

describe("the console's keys, as the terminal reads them", () => {
  test("a key counts when it is released", () => {
    const { keys, pressed, wait } = chord();
    keys.level("left", true, "keyboard");
    wait(100);
    expect(pressed).toEqual([]);
    keys.level("left", false, "keyboard");
    expect(pressed).toEqual([{ kind: "key", side: "left" }]);
  });

  test("held 0.7 s, a long press at once, and nothing on release", () => {
    const { keys, pressed, wait } = chord();
    keys.level("right", true, "pointer:1");
    wait(LONG_MS - 1);
    expect(pressed).toEqual([]);
    wait(1);
    expect(pressed).toEqual([{ kind: "longKey", side: "right" }]);
    keys.level("right", false, "pointer:1");
    expect(pressed).toHaveLength(1);
  });

  test("both arrow keys: the second one down is both, releasing them sends nothing more", () => {
    const { keys, pressed, wait } = chord();
    keys.level("left", true, "keyboard");
    keys.level("right", true, "keyboard");
    expect(keys.held()).toEqual(["left", "right"]);
    wait(LONG_MS * 2);
    keys.level("left", false, "keyboard");
    keys.level("right", false, "keyboard");
    expect(pressed).toEqual([{ kind: "both" }]);
    // The next press is a single key again.
    keys.level("right", true, "keyboard");
    keys.level("right", false, "keyboard");
    expect(pressed.at(-1)).toEqual({ kind: "key", side: "right" });
  });

  test("a mouse holding one key and an arrow key for the other", () => {
    const { keys, pressed } = chord();
    keys.level("right", true, "pointer:1");
    keys.level("left", true, "keyboard");
    keys.level("right", false, "pointer:1");
    keys.level("left", false, "keyboard");
    expect(pressed).toEqual([{ kind: "both" }]);
  });

  test("once a key is long, the other one is its own press, as on the terminal", () => {
    const { keys, pressed, wait } = chord();
    keys.level("left", true, "pointer:1");
    wait(LONG_MS);
    keys.level("right", true, "keyboard");
    keys.level("right", false, "keyboard");
    keys.level("left", false, "pointer:1");
    expect(pressed).toEqual([
      { kind: "longKey", side: "left" },
      { kind: "key", side: "right" },
    ]);
  });

  test("a key held by two sources is up only when both let go", () => {
    const { keys, pressed } = chord();
    keys.level("left", true, "pointer:1");
    keys.level("left", true, "keyboard");
    keys.level("left", false, "pointer:1");
    expect(pressed).toEqual([]);
    keys.level("left", false, "keyboard");
    expect(pressed).toEqual([{ kind: "key", side: "left" }]);
  });
});
