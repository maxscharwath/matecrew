export type Side = "left" | "right";

/**
 * The touch keys as the terminal reads them (`TouchKeys` in device/core): a key counts when it is
 * released, both keys when the second goes down while the first is held. Each key can be held by
 * several sources at once (a pointer, an arrow key): it is up when none holds it.
 */
export class KeyChord {
  private readonly sources = { left: new Set<string>(), right: new Set<string>() };
  private chord = false;

  /** `source` pressed or released `side`; the press this completes, if any. */
  level(side: Side, high: boolean, source: string): Side | "both" | null {
    const own = this.sources[side];
    const other = side === "left" ? this.sources.right : this.sources.left;
    const wasDown = own.size > 0;
    if (high) own.add(source);
    else own.delete(source);
    const down = own.size > 0;
    if (down && !wasDown && other.size > 0 && !this.chord) {
      this.chord = true;
      return "both";
    }
    if (!down && wasDown) {
      const press = this.chord ? null : side;
      // The chord ends once both keys are up: releasing them sends nothing more.
      if (other.size === 0) this.chord = false;
      return press;
    }
    return null;
  }

  held(): Side[] {
    return (["left", "right"] as const).filter((side) => this.sources[side].size > 0);
  }
}
