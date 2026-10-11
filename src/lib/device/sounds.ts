import type { Beep } from "@/lib/device/virtual/wasm";

/** The terminal's sounds an admin turns on or off (`Device.sounds`), in the settings' order. */
export const SOUNDS = ["boot", "key", "badge", "error", "notification"] as const;
export type Sound = (typeof SOUNDS)[number];
export type Sounds = Record<Sound, boolean>;

/** `Device.sounds` ("boot,key,...") as one switch per sound; unknown names are dropped. */
export function parseSounds(text: string): Sounds {
  const on = new Set(text.split(",").map((name) => name.trim()));
  return Object.fromEntries(SOUNDS.map((sound) => [sound, on.has(sound)])) as Sounds;
}

/** The sounds turned on, as `Device.sounds` stores them: in the settings' order, once each. */
export function soundsText(on: Iterable<string>): string {
  const set = new Set(on);
  return SOUNDS.filter((sound) => set.has(sound)).join(",");
}

/** Which switch a beep answers to, as `Sounds::allows` on the terminal. */
export function soundOf(beep: Beep): Sound {
  switch (beep) {
    case "boot":
      return "boot";
    case "key":
      return "key";
    case "badge":
    case "accepted":
    case "unknown":
      return "badge";
    case "error":
      return "error";
    case "notification":
      return "notification";
  }
}
