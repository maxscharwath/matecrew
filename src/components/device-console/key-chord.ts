export type Side = "left" | "right";

/** What the keys make, as the terminal's: a press, a long press, both keys. */
export type KeyPress = { kind: "key"; side: Side } | { kind: "longKey"; side: Side } | { kind: "both" };

/** As the terminal's keys (`LONG_MS` in device/board). */
export const LONG_MS = 700;

/** Runs `run` after `ms`; returns what cancels it. */
export type Later = (run: () => void, ms: number) => () => void;

const timeout: Later = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

/**
 * The touch keys as the terminal reads them (`Presses` in device/board): a key is a press when
 * it is released, a long press the moment it has been held `LONG_MS` (then nothing on release),
 * and both keys when the second goes down while the first is held and not long yet. Each key
 * can be held by several sources at once (a pointer, an arrow key): it is up when none holds it.
 */
export class KeyChord {
  private readonly sources = { left: new Set<string>(), right: new Set<string>() };
  /** Both keys went down: nothing more until both are up. */
  private chord = false;
  /** Held into a long press: its release sends nothing. */
  private readonly spent = { left: false, right: false };
  private readonly timers: Partial<Record<Side, () => void>> = {};

  constructor(
    private readonly press: (key: KeyPress) => void,
    private readonly later: Later = timeout,
  ) {}

  /** `source` pressed or released `side`. */
  level(side: Side, high: boolean, source: string): void {
    const own = this.sources[side];
    const other: Side = side === "left" ? "right" : "left";
    const wasDown = own.size > 0;
    if (high) own.add(source);
    else own.delete(source);
    const down = own.size > 0;
    if (down === wasDown) return;
    if (down) return this.down(side, other);
    this.cancel(side);
    if (this.chord) {
      // The chord ends once both keys are up.
      if (this.sources[other].size === 0) this.chord = false;
    } else if (this.spent[side]) {
      this.spent[side] = false;
    } else {
      this.press({ kind: "key", side });
    }
  }

  held(): Side[] {
    return (["left", "right"] as const).filter((side) => this.sources[side].size > 0);
  }

  /** Stops the long-press timers (the console closing). */
  dispose(): void {
    this.cancel("left");
    this.cancel("right");
  }

  private down(side: Side, other: Side) {
    if (this.chord) return;
    if (this.sources[other].size > 0 && !this.spent[other]) {
      this.chord = true;
      this.cancel(other);
      return this.press({ kind: "both" });
    }
    this.timers[side] = this.later(() => this.hold(side), LONG_MS);
  }

  private hold(side: Side) {
    delete this.timers[side];
    if (this.chord || this.sources[side].size === 0) return;
    this.spent[side] = true;
    this.press({ kind: "longKey", side });
  }

  private cancel(side: Side) {
    this.timers[side]?.();
    delete this.timers[side];
  }
}
