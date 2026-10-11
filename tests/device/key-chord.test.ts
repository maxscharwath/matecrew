import { describe, expect, test } from "bun:test";
import { KeyChord } from "@/components/device-console/key-chord";

describe("both keys from the console, as the terminal reads them", () => {
  test("a key counts when it is released", () => {
    const keys = new KeyChord();
    expect(keys.level("left", true, "keyboard")).toBeNull();
    expect(keys.level("left", false, "keyboard")).toBe("left");
  });

  test("both arrow keys: the second one down is both, releasing them sends nothing more", () => {
    const keys = new KeyChord();
    expect(keys.level("left", true, "keyboard")).toBeNull();
    expect(keys.level("right", true, "keyboard")).toBe("both");
    expect(keys.held()).toEqual(["left", "right"]);
    expect(keys.level("left", false, "keyboard")).toBeNull();
    expect(keys.level("right", false, "keyboard")).toBeNull();
    // The next press is a single key again.
    expect(keys.level("right", true, "keyboard")).toBeNull();
    expect(keys.level("right", false, "keyboard")).toBe("right");
  });

  test("a mouse holding one key and an arrow key for the other", () => {
    const keys = new KeyChord();
    expect(keys.level("right", true, "pointer:1")).toBeNull();
    expect(keys.level("left", true, "keyboard")).toBe("both");
    expect(keys.level("right", false, "pointer:1")).toBeNull();
    expect(keys.level("left", false, "keyboard")).toBeNull();
  });

  test("a key held by two sources is up only when both let go", () => {
    const keys = new KeyChord();
    keys.level("left", true, "pointer:1");
    keys.level("left", true, "keyboard");
    expect(keys.level("left", false, "pointer:1")).toBeNull();
    expect(keys.level("left", false, "keyboard")).toBe("left");
  });
});
