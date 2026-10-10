/** Input pin levels, with independent sources so keyboard and multi-touch can overlap. */
export class VirtualGpio {
  private readonly drivers = new Map<number, Set<string>>();
  private pwm: { start: number; end: number; hz: number }[] = [];
  read(pin: number, nowMs = performance.now()): boolean {
    if (pin === 44) {
      const note = this.pwm.find(
        (note) => nowMs >= note.start && nowMs < note.end,
      );
      return (
        !!note &&
        note.hz > 0 &&
        (((nowMs - note.start) * note.hz) / 1000) % 1 < 0.5
      );
    }
    return (this.drivers.get(pin)?.size ?? 0) > 0;
  }
  /** Timestamped LEDC program; read(44, t) exposes the actual 50%-duty pin level. */
  playPwm(
    pattern: readonly (readonly [number, number])[],
    nowMs: number,
  ): void {
    this.pwm = this.pwm.filter((note) => note.end > nowMs);
    let start = Math.max(nowMs, this.pwm.at(-1)?.end ?? nowMs);
    for (const [hz, ms] of pattern) {
      this.pwm.push({ start, end: start + ms, hz });
      start += ms;
    }
  }
  clearPwm(): void {
    this.pwm = [];
  }
  drive(pin: number, high: boolean, source: string): void {
    if (pin !== 5 && pin !== 8)
      throw new Error("Only the TTP223 input pins can be driven");
    const drivers = this.drivers.get(pin) ?? new Set<string>();
    if (high) drivers.add(source);
    else drivers.delete(source);
    this.drivers.set(pin, drivers);
  }
  release(): void {
    this.drivers.clear();
  }
}
