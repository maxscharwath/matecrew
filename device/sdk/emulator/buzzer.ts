/** Web Audio output for the board's LEDC GPIO 6 (D5) waveform (square, 50% duty).
 * Frequencies and durations come from Rust, shared with the physical firmware.
 */
export class VirtualBuzzer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes = new Set<OscillatorNode>();
  private nextAt = 0;
  private volume = 0.3;
  private enabled = true;
  constructor(private readonly createContext = () => new AudioContext()) {}

  async unlock(): Promise<boolean> {
    this.context ??= this.createContext();
    if (!this.master) {
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      this.master.gain.value = this.enabled ? this.volume * 0.08 : 0;
    }
    if (this.context.state !== "running") await this.context.resume();
    return this.context.state === "running";
  }
  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    this.updateGain();
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
    this.updateGain();
  }
  private updateGain(): void {
    if (this.master && this.context)
      this.master.gain.setValueAtTime(
        this.enabled ? this.volume * 0.08 : 0,
        this.context.currentTime,
      );
  }
  play(pattern: readonly (readonly [hz: number, ms: number])[]): boolean {
    const audio = this.context;
    if (!this.enabled || !audio || audio.state !== "running" || !this.master)
      return false;
    let at = Math.max(audio.currentTime, this.nextAt);
    for (const [hz, ms] of pattern) {
      if (
        !Number.isFinite(hz) ||
        !Number.isFinite(ms) ||
        hz < 0 ||
        hz > 20000 ||
        ms < 0 ||
        ms > 5000
      )
        return false;
    }
    for (const [hz, ms] of pattern) {
      if (hz > 0) {
        const oscillator = audio.createOscillator();
        oscillator.type = "square";
        oscillator.frequency.value = hz;
        oscillator.connect(this.master);
        this.nodes.add(oscillator);
        oscillator.onended = () => {
          oscillator.disconnect();
          this.nodes.delete(oscillator);
        };
        oscillator.start(at);
        oscillator.stop(at + ms / 1000);
      }
      at += ms / 1000;
    }
    this.nextAt = at;
    return true;
  }
  stop(): void {
    for (const node of this.nodes) {
      node.onended = null;
      node.stop();
      node.disconnect();
    }
    this.nodes.clear();
    this.nextAt = 0;
  }
  dispose(): void {
    this.stop();
    this.master?.disconnect();
    void this.context?.close();
    this.context = null;
    this.master = null;
  }
}
