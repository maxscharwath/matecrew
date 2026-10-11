/**
 * The terminal's own flow and screens with made-up data, for a page that shows the terminal
 * without one: no link, no token, no request to the site. The firmware's Rust (wasm.ts) draws
 * every frame; this file only answers its effects the way the site would, from memory: a take
 * lowers the stock on the main screen, "Mon compte" gets a small made-up account. Its beeps go
 * to whoever plays them (`setBeep`).
 *
 * The state is the dashboard fixture the device tests render (device/fixtures/dashboard.json), or a
 * real office's (`DemoOffice`): then "Mon compte" is the viewer's own and the reader badges them.
 */
import definition from "../../../../device/fixtures/dashboard.json";
import { deviceState, type DeviceAccount, type DeviceState } from "@/lib/device/contract";
import { DeviceWasm, type Effect, type FlowEvent, type Side } from "@/lib/device/virtual/wasm";

/** What the demo's screens say that the site would normally send: keys and dashboard labels. */
export type DemoStrings = {
  take: string;
  account: string;
  lowLabel: string;
  moreLabel: string;
  chartLabel: string;
  /** The made-up badge holder. */
  holder: string;
};

/**
 * A real office for the demo to run on, from the site: its terminal's state with no badge in it, and
 * the account of whoever is looking.
 */
export type DemoOffice = { state: DeviceState; account: DeviceAccount };

/** The one badge the demo knows: 7 bytes, like an office badge's UID. */
const DEMO_UID = "04A1B2C3D4E5F6";
/** As long as the site takes to answer "Mon compte", roughly. */
const ACCOUNT_DELAY_MS = 600;
/** The main screen's clock moves on while it shows. */
const CLOCK_EVERY_MS = 30_000;

function demoState(strings: DemoStrings, locale: string): DeviceState {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return deviceState.parse({
    device: { id: "demo", name: "MateCrew" },
    office: { name: definition.officeName, timezone: "Europe/Zurich", locale },
    keys: { left: { label: strings.take }, right: { label: strings.account } },
    items: definition.items.map((item, n) => ({ id: `demo-${n + 1}`, name: item.name, stock: item.stock, picture: item.picture })),
    badges: [{ uid: DEMO_UID, name: strings.holder }],
    syncTimes: [],
    serverTime: now.toISOString(),
    screen: {
      ...definition,
      time,
      lowLabel: strings.lowLabel,
      moreLabel: strings.moreLabel,
      chartLabel: strings.chartLabel,
      leftLabel: strings.take,
      rightLabel: strings.account,
    },
    firmware: null,
    appUrl: null,
    theme: "paper",
    // The terminal reads its clock from its UTC time and this offset: the visitor's own.
    clock: { offset: -now.getTimezoneOffset(), next: null, format: "24", date: true },
  });
}

/** The readings its status bar shows: a good Wi-Fi, a battery three quarters full. */
function deviceInfo(state: DeviceState): Record<string, unknown> {
  return {
    unix: Math.floor(Date.now() / 1000),
    board: { name: "XIAO ESP32-S3", simulated: true },
    firmware: { version: "web", build: "demo" },
    site: globalThis.location?.host ?? null,
    device: { id: state.device.id, name: state.device.name },
    chip: { model: "Wasm", id: "demo" },
    wifi: { rssi: -55, ssid: "demo" },
    battery: { millivolts: 3950, usb: false },
    uptimeMinutes: Math.floor(performance.now() / 60_000),
  };
}

function demoAccount(name: string, state: DeviceState): DeviceAccount {
  return {
    name,
    today: 1,
    week: 4,
    month: 11,
    cost: "CHF 12.40",
    days: [[1, 0], [0, 1], [0, 0], [1, 1], [0, 0], [2, 1], [1, 0]],
    products: state.items.slice(0, 2).map((item) => item.name),
    labels: Array.from({ length: 7 }, (_, i) =>
      new Date(Date.now() - (6 - i) * 86_400_000).toLocaleDateString(state.office.locale, { weekday: "short" }),
    ),
    purchases: [],
    avatar: null,
  };
}

/** 53 random bits, as a take id needs (flow.rs). */
function random53(): number {
  const [high, low] = crypto.getRandomValues(new Uint32Array(2));
  return (high & 0x1fffff) * 2 ** 32 + low;
}

export class DemoTerminal {
  private bits: Uint8Array | null = null;
  private readonly listeners = new Set<() => void>();
  private tickTimer: ReturnType<typeof setTimeout> | undefined;
  private accountTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly clockTimer: ReturnType<typeof setInterval>;
  private disposed = false;
  private onBeep: (tones: [hz: number, ms: number][]) => void = () => {};

  private constructor(
    private readonly wasm: DeviceWasm,
    private state: DeviceState,
    private readonly account: DeviceAccount | null,
  ) {
    wasm.setState(state);
    this.showMain();
    this.clockTimer = setInterval(() => {
      if (this.wasm.deadline() === null) this.showMain();
    }, CLOCK_EVERY_MS);
  }

  static async start(strings: DemoStrings, locale: string, office?: DemoOffice): Promise<DemoTerminal> {
    const wasm = await DeviceWasm.load();
    if (!office) return new DemoTerminal(wasm, demoState(strings, locale), null);
    const badges = [{ uid: DEMO_UID, name: office.account.name }];
    return new DemoTerminal(wasm, { ...office.state, badges }, office.account);
  }

  // For useSyncExternalStore.
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.bits;

  press(side: Side): void {
    this.dispatch({ type: "key", side });
  }

  /** Plays the buzzer's tones, as the firmware drives its PWM. */
  setBeep(play: (tones: [hz: number, ms: number][]) => void): void {
    this.onBeep = play;
  }

  /** The demo badge on the reader. */
  tap(): void {
    this.dispatch({ type: "badge", uid: DEMO_UID });
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.tickTimer);
    clearTimeout(this.accountTimer);
    clearInterval(this.clockTimer);
    this.listeners.clear();
  }

  private dispatch(event: FlowEvent): void {
    if (this.disposed) return;
    const effects = this.wasm.handle(event, {
      nowMs: Math.floor(performance.now()),
      unix: Math.floor(Date.now() / 1000),
      random: random53(),
      claim: null,
    });
    for (const effect of effects) this.apply(effect);
    clearTimeout(this.tickTimer);
    const deadline = this.wasm.deadline();
    if (deadline !== null)
      this.tickTimer = setTimeout(() => this.dispatch({ type: "tick" }), Math.max(0, deadline - performance.now()) + 5);
  }

  private apply(effect: Effect): void {
    switch (effect.type) {
      case "show":
        if (effect.screen.type === "main") return this.showMain();
        this.wasm.setDeviceInfo(deviceInfo(this.state));
        return this.display(this.wasm.render({ type: "flow", screen: effect.screen }));
      case "queue":
        return this.taken(effect.take.itemId);
      case "fetchAccount": {
        const holder = this.state.badges.find((b) => b.uid === effect.uid)?.name ?? "";
        clearTimeout(this.accountTimer);
        this.accountTimer = setTimeout(
          () => this.dispatch({ type: "account", account: this.account ?? demoAccount(holder, this.state) }),
          ACCOUNT_DELAY_MS,
        );
        return;
      }
      case "cancelPurchase":
        // A real office's purchases are real: the 3D screen cannot cancel them.
        return this.dispatch({ type: "purchaseCancelled", cancelled: this.account === null });
      case "beep":
        return this.onBeep(this.wasm.buzzerPattern(effect.beep));
      default:
        // Unknown badges and serving have nothing to answer here.
        return;
    }
  }

  /** As the site does after a take: one can less, on the main screen too. */
  private taken(itemId: string | null): void {
    const index = this.state.items.findIndex((item) => item.id === itemId);
    if (index < 0) return;
    const lower = <T extends { stock: number }>(list: T[]) =>
      list.map((item, i) => (i === index ? { ...item, stock: Math.max(0, item.stock - 1) } : item));
    this.state = { ...this.state, items: lower(this.state.items), screen: { ...this.state.screen, items: lower(this.state.screen.items) } };
    this.wasm.setState(this.state);
  }

  private showMain(): void {
    this.wasm.setDeviceInfo(deviceInfo(this.state));
    this.display(this.wasm.render({ type: "main", state: this.state, offline: false }));
  }

  private display(bits: Uint8Array): void {
    this.bits = bits;
    for (const listener of this.listeners) listener();
  }
}
