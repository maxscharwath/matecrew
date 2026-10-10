import { downloadImage } from "./images";
/**
 * A terminal that runs in the browser: the take flow and the screens come
 * from the firmware's own Rust (see wasm.ts), and this file plays the part of
 * device/firmware/src/main.rs. It links with a code, syncs, keeps its queue
 * of takes, mirrors its panel to the site and obeys the console, through the
 * same API as the real one.
 */
import { deviceState } from "@/lib/device/contract";
import type {
  CommandsResponse,
  DeviceState,
  DeviceTheme,
  DeviceTake,
  LinkStartResponse,
  LinkTokenResponse,
  ServeResponse,
} from "@/lib/device/contract";
import type {
  Beep,
  AppEffect,
  DeviceWasm,
  Effect,
  FlowEvent,
  Side,
  View,
} from "@/lib/device/virtual/wasm";

export const FIRMWARE_VERSION = "web";
/** Like the firmware's loop: sync this often while nothing else asks for it. */
const SYNC_EVERY_MS = 120_000;
const COMMANDS_WAIT_SECONDS = 25;
const MAX_LOGS = 200;
/** As the firmware's display: a full refresh at first, then on the main screen every 40 partial ones or every hour. */
const FULL_EVERY = 40;
const FULL_AFTER_MS = 3_600_000;

/** The simulated readings the virtual terminal reports, set from the console. */
export type Sensors = { batteryMv: number; wifiRssi: number; usb: boolean };

export type Phase = "booting" | "linking" | "online" | "offline";

export type LogEntry = {
  id: number;
  at: number;
  kind: "info" | "http" | "flow" | "error";
  text: string;
};

export type Snapshot = {
  phase: Phase;
  /** What the panel shows: 800 x 480, packed 1-bit, 1 = ink. */
  bits: Uint8Array | null;
  /** Counts panel refreshes, so the page can draw each one. */
  refreshes: number;
  /** How the last one was done: only a full refresh flashes on the real panel. */
  refresh: "full" | "partial";
  /** While linking: the code on screen and the page that approves it. */
  link: { code: string; url: string } | null;
  linked: { deviceId: string; deviceName: string; officeName: string } | null;
  hardwareId: string;
  queue: DeviceTake[];
  network: boolean;
  theme: DeviceTheme;
  app: "mate" | "showcase";
  logs: LogEntry[];
};

type Stored = {
  hardwareId: string;
  token: string | null;
  deviceId: string | null;
  deviceName: string | null;
  officeName: string | null;
  queue: DeviceTake[];
  unknownBadges: string[];
  state?: DeviceState | null;
  appMode?: "mate" | "showcase";
  showcaseData?: Record<string, unknown>;
  appBytes?: number[];
  appData?: Record<string, unknown>;
  theme?: DeviceTheme;
};

class Unlinked extends Error {}
class NoNetwork extends Error {}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => (clearTimeout(timer), reject(signal.reason)),
      { once: true },
    );
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class VirtualDevice {
  private stored: Stored;
  private snapshot: Snapshot;
  private readonly listeners = new Set<() => void>();
  private run = new AbortController();
  private state: DeviceState | null = null;
  private appLoaded = false;
  private pendingApp: "mate" | "showcase" | null = null;
  private readonly pendingImages = new Set<string>();
  /** Server time at a local `performance.now()`, set by each sync. */
  private clock: { serverMs: number; at: number } | null = null;
  /** What is on the panel, to redraw it when the wasm is rebuilt. */
  private view: View | "main" | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | undefined;
  private overlayTimer: ReturnType<typeof setTimeout> | undefined;
  private gpioTimer: ReturnType<typeof setInterval> | undefined;
  readonly gpio = new VirtualGpio();
  private frameUpload: { busy: boolean; next: Uint8Array | null } = {
    busy: false,
    next: null,
  };
  private logId = 0;
  private partials = 0;
  /** Pixels partial refreshes turned since the last full one. */
  private ghost = 0;
  /** SHA-256 of the token in hex, for the badge claim links. */
  private claimKey: string | null = null;
  private lastFull: number | null = null;

  private sensors: Sensors = { batteryMv: 4000, wifiRssi: -55, usb: false };
  private onBeep: (beep: Beep) => void = () => {};

  constructor(
    private wasm: DeviceWasm,
    private readonly storageKey: string,
  ) {
    this.stored = this.load();
    this.state = this.stored.state ?? null;
    if (this.state) this.wasm.setState(this.state);
    this.restoreApp();
    this.snapshot = {
      phase: "booting",
      bits: null,
      refreshes: 0,
      refresh: "full",
      link: null,
      linked: this.linkedInfo(),
      hardwareId: this.stored.hardwareId,
      queue: this.stored.queue,
      network: true,
      theme: this.stored.theme ?? this.state?.theme ?? "paper",
      app: this.stored.appMode ?? "mate",
      logs: [],
    };
  }

  // For useSyncExternalStore.
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;

  /** Preview and persist device styling; API data and app interactions remain intact. */
  setTheme(theme: DeviceTheme): void {
    this.stored.theme = theme;
    if (this.state) {
      this.state = { ...this.state, theme };
      this.stored.state = this.state;
      this.wasm.setState(this.state);
    }
    this.wasm.setTheme(theme);
    if (this.appLoaded) this.cacheCurrentApp();
    this.save();
    this.update({ theme });
    if (this.view === "main") this.showMain();
    else if (this.view) this.show(this.view);
  }

  start(): void {
    this.startGpio();
    void this.boot(this.run.signal);
  }

  dispose(): void {
    clearInterval(this.gpioTimer);
    this.gpio.release();
    this.gpio.clearPwm();
    this.wasm.sampleGpio(false, false, performance.now());
    clearTimeout(this.overlayTimer);
    this.run.abort();
    clearTimeout(this.tickTimer);
  }

  restart(): void {
    this.log("info", "Redémarrage");
    this.dispose();
    this.run = new AbortController();
    this.wasm.reset();
    this.startGpio();
    this.state = this.stored.state ?? null;
    if (this.state) this.wasm.setState(this.state);
    this.restoreApp();
    this.claimKey = null;
    this.clock = null;
    this.update({ phase: "booting", link: null });
    this.start();
  }

  /** Forgets the token and the queue, as `just forget` does to the real one. */
  forget(): void {
    this.stored = { ...this.blank(), hardwareId: this.stored.hardwareId };
    this.save();
    this.update({ linked: null, queue: [] });
    this.restart();
  }

  setNetwork(on: boolean): void {
    this.log("info", on ? "Wi-Fi rétabli" : "Wi-Fi coupé");
    this.update({ network: on, phase: on ? this.snapshot.phase : "offline" });
    if (!on && this.view === "main") this.showMain();
    if (on && this.stored.token)
      void this.sync().catch((error: unknown) => this.fail(error));
  }

  getSensors(): Sensors {
    return this.sensors;
  }

  /** Shown in the status bar at once; reported to the site with the next sync. */
  setSensors(sensors: Sensors): void {
    this.sensors = sensors;
    if (this.view === "main" && this.wasmIdle()) this.showMain();
  }

  setBeep(play: (beep: Beep) => void): void {
    this.onBeep = play;
  }
  buzzerPattern(beep: Beep): [number, number][] {
    return this.wasm.buzzerPattern(beep);
  }
  testBuzzer(beep: Beep): void {
    this.beep(beep);
  }
  private beep(beep: Beep): void {
    this.gpio.playPwm(this.wasm.buzzerPattern(beep), performance.now());
    this.onBeep(beep);
  }
  setKeyLevel(side: Side, high: boolean, source: string): void {
    this.gpio.drive(side === "left" ? 5 : 8, high, source);
  }
  releaseKeys(): void {
    this.gpio.release();
  }
  private startGpio(): void {
    clearInterval(this.gpioTimer);
    this.gpioTimer = setInterval(() => {
      const edges = this.wasm.sampleGpio(this.gpio.sample(5), this.gpio.sample(8), performance.now());
      if (edges & 1) this.press("left");
      if (edges & 2) this.press("right");
      // Both keys belong to the terminal, whatever app runs: its about page.
      if (edges & 4) this.dispatch({ type: "bothKeys" });
    }, 20);
  }

  syncNow(): void {
    if (this.stored.token)
      void this.sync().catch((error: unknown) => this.fail(error));
  }
  notify(message: string, durationMs = 5000): boolean {
    if (!this.wasm.notify(message, durationMs, performance.now())) return false;
    this.beep("notification");
    this.scheduleOverlay();
    if (this.view === "main") this.showMain();
    else if (this.view) this.show(this.view);
    return true;
  }

  selectApp(app: "mate" | "showcase"): void {
    if (!this.wasmIdle()) {
      this.pendingApp = app;
      return;
    }
    if (this.appLoaded) this.cacheCurrentApp();
    this.stored.appMode = app;
    this.restoreApp();
    this.save();
    this.update({ app });
    this.showMain();
    void this.refreshAppImages().then(() => {
      if (this.view === "main") this.showMain();
    });
  }

  private cacheCurrentApp(): void {
    if (!this.appLoaded) return;
    const data = this.wasm.cacheApp();
    if (this.stored.appMode === "showcase") this.stored.showcaseData = data;
    else this.stored.appData = data;
  }

  press(side: Side): void {
    if (this.appLoaded && this.wasmIdle()) {
      this.wasm.tickApp(performance.now());
      this.appEffects(
        this.wasm.inputApp(side) ??
          this.wasm.pressApp(side === "left" ? 32 : 168, 113),
      );
    } else this.dispatch({ type: "key", side });
  }

  tapScreen(x: number, y: number): void {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      x >= 200 ||
      y < 0 ||
      y >= 120
    )
      return;
    if (this.appLoaded && this.wasmIdle()) {
      this.wasm.tickApp(performance.now());
      this.appEffects(this.wasm.pressApp(x, y));
    } else if (y >= 104 && (x < 70 || x >= 130))
      this.press(x < 70 ? "left" : "right");
  }

  private appEffects(effects: AppEffect[]): void {
    this.scheduleOverlay();
    let domain = false;
    for (const effect of effects) {
      if (
        effect.kind === "emit" &&
        (effect.name === "take" || effect.name === "summary")
      ) {
        domain = true;
        this.dispatch({
          type: "key",
          side: effect.name === "take" ? "left" : "right",
        });
      } else if (effect.kind === "beep") {
        this.beep(effect.tone === "success" ? "accepted" : effect.tone);
      } else if (effect.kind === "fetch") {
        void this.fetchAppResource(effect.id, effect.path)
          .then(async () => {
            await this.refreshAppImages();
            this.cacheCurrentApp();
            this.save();
            if (this.view === "main") this.showMain();
          })
          .catch((error) => this.fail(error));
      }
    }
    this.cacheCurrentApp();
    this.save();
    if (!domain) {
      this.showMain();
      void this.refreshAppImages().then(() => {
        if (this.view === "main") this.showMain();
      });
    }
  }
  private scheduleOverlay(): void {
    clearTimeout(this.overlayTimer);
    const deadline = this.wasm.overlayDeadline();
    if (deadline !== null)
      this.overlayTimer = setTimeout(
        () => {
          if (this.wasm.tickApp(performance.now())) {
            if (this.view === "main") this.showMain();
            else if (this.view) this.show(this.view);
          }
          this.scheduleOverlay();
        },
        Math.max(0, deadline - performance.now()) + 1,
      );
  }

  tap(uid: string): void {
    if (this.stored.appMode === "showcase") return;
    this.dispatch({ type: "badge", uid });
  }

  /** In `bun dev`, `just web` rebuilt the wasm: keep going with the new screens. */
  replaceWasm(wasm: DeviceWasm): void {
    this.wasm = wasm;
    if (this.state) wasm.setState(this.state);
    this.restoreApp();
    this.log("info", "Nouveau wasm chargé");
    if (this.view === "main") this.showMain();
    if (this.view && this.view !== "main")
      this.display(wasm.render(this.view), this.view);
  }

  // Boot, link, sync: what firmware/src/main.rs does.

  private async boot(signal: AbortSignal): Promise<void> {
    try {
      for (let stage = 0; stage < 4; stage++) {
        this.show({ type: "boot", stage });
        await sleep(stage === 3 ? 180 : 350, signal);
      }
      while (!this.stored.token) {
        await this.link(signal).catch(async (error: unknown) => {
          if (signal.aborted) throw error;
          this.fail(error);
          await sleep(3000, signal);
        });
      }
      await this.sync().catch((error: unknown) => this.fail(error));
      void this.pollCommands(signal);
      for (;;) {
        await sleep(SYNC_EVERY_MS, signal);
        if (this.wasmIdle())
          await this.sync().catch((error: unknown) => this.fail(error));
      }
    } catch (error) {
      if (!signal.aborted) this.fail(error);
    }
  }

  private async link(signal: AbortSignal): Promise<void> {
    this.update({ phase: "linking" });
    for (;;) {
      const start = (await (
        await this.api("POST", "/api/device/link", {
          json: {
            hardwareId: this.stored.hardwareId,
            firmwareVersion: FIRMWARE_VERSION,
          },
          auth: false,
          signal,
        })
      ).json()) as LinkStartResponse;
      this.update({
        link: { code: start.user_code, url: start.verification_uri_complete },
      });
      this.show({
        type: "link",
        code: start.user_code,
        url: start.verification_uri.replace(/^https?:\/\//, ""),
        urlWithCode: start.verification_uri_complete,
      });

      let interval = start.interval * 1000;
      const expires = Date.now() + start.expires_in * 1000;
      while (Date.now() < expires) {
        await sleep(interval, signal);
        const response = await this.api("POST", "/api/device/link/token", {
          json: { device_code: start.device_code },
          auth: false,
          signal,
          quiet: true,
          errors: true,
        });
        const body = (await response.json()) as Partial<LinkTokenResponse> & {
          error?: string;
        };
        if (response.ok && body.access_token) {
          this.stored = {
            ...this.stored,
            token: body.access_token,
            deviceId: body.device_id ?? null,
            deviceName: body.device_name ?? null,
            officeName: body.office_name ?? null,
          };
          this.save();
          this.log("info", `Lié : ${body.device_name} (${body.office_name})`);
          this.update({ link: null, linked: this.linkedInfo() });
          this.show({
            type: "linked",
            office: body.office_name ?? "",
            name: body.device_name ?? "",
          });
          await sleep(3000, signal);
          return;
        }
        if (body.error === "slow_down") interval += 5000;
        else if (body.error === "access_denied") {
          this.log("error", "Liaison refusée sur le site");
          break;
        } else if (body.error !== "authorization_pending") break;
      }
      this.update({ link: null });
    }
  }

  /**
   * Sends the queue, fetches screen data with state, and draws the main screen locally.
   */
  private async sync(): Promise<void> {
    if (this.stored.queue.length > 0) {
      const response = await this.api("POST", "/api/device/takes", {
        json: { takes: this.stored.queue },
      });
      const { done, rejected } = (await response.json()) as {
        done: string[];
        rejected: { id: string; reason: string }[];
      };
      for (const r of rejected)
        this.log("error", `Prise ${r.id} refusée : ${r.reason}`);
      this.stored.queue = this.stored.queue.filter(
        (take) => !done.includes(take.id),
      );
      this.save();
      this.update({ queue: this.stored.queue });
    }

    if (!this.claimKey && this.stored.token)
      this.claimKey = await sha256Hex(this.stored.token);
    const state = deviceState.parse(
      await (await this.api("GET", "/api/device/state")).json(),
    );
    state.theme = this.stored.theme ?? state.theme;
    this.state = state;
    this.wasm.setState(state);
    this.clock = {
      serverMs: Date.parse(state.serverTime),
      at: performance.now(),
    };
    this.stored = {
      ...this.stored,
      state,
      deviceId: state.device.id,
      deviceName: state.device.name,
      officeName: state.office.name,
    };
    this.save();
    this.update({ linked: this.linkedInfo(), theme: state.theme });

    await this.api("POST", "/api/device/status", {
      json: {
        firmwareVersion: FIRMWARE_VERSION,
        batteryMv: this.sensors.batteryMv,
        wifiRssi: this.sensors.wifiRssi,
        unknownBadges: this.stored.unknownBadges,
      },
    });
    this.stored.unknownBadges = [];
    this.save();

    if (this.stored.appMode === "showcase") {
      this.wasm.updateApp("showcase", state);
      await this.refreshAppImages();
      this.cacheCurrentApp();
      this.save();
    } else if (state.appUrl && !this.stored.appMode) {
      const bytes = new Uint8Array(
        await (await this.api("GET", state.appUrl)).arrayBuffer(),
      );
      const same =
        this.stored.appBytes?.length === bytes.length &&
        this.stored.appBytes.every((v, i) => v === bytes[i]);
      if (!this.appLoaded || !same) {
        this.wasm.loadApp(bytes);
        this.appLoaded = true;
        this.stored.appBytes = [...bytes];
        this.stored.appData = {};
      }
      for (const effect of this.wasm.advanceApp(
        Math.floor(performance.now()),
        false,
      )) {
        if (effect.kind === "fetch")
          await this.fetchAppResource(effect.id, effect.path);
      }
      await this.refreshAppImages();
      this.cacheCurrentApp();
      this.save();
    } else {
      this.appLoaded = false;
      this.stored.appBytes = undefined;
      this.stored.appData = undefined;
    }
    this.update({ phase: "online" });
    if (this.stored.theme) this.wasm.setTheme(this.stored.theme);
    if (this.wasmIdle()) this.showMain();
  }

  private async pollCommands(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        if (!this.snapshot.network) {
          await sleep(2000, signal);
          continue;
        }
        const response = await this.api(
          "GET",
          `/api/device/commands?wait=${COMMANDS_WAIT_SECONDS}`,
          { signal, quiet: true },
        );
        const { commands } = (await response.json()) as CommandsResponse;
        for (const command of commands) {
          this.log(
            "info",
            `Console : ${command.kind}${"side" in command ? ` ${command.side}` : ""}${"uid" in command ? ` ${command.uid}` : ""}`,
          );
          if (command.kind === "key") this.press(command.side);
          else if (command.kind === "badge") this.tap(command.uid);
          else if (command.kind === "tap") this.tapScreen(command.x, command.y);
          else if (command.kind === "sync") {
            if (command.app) this.selectApp(command.app);
            else await this.sync();
          } else if (
            command.kind === "restart" ||
            command.kind === "forgetWifi"
          )
            return this.restart();
        }
      } catch (error) {
        if (signal.aborted) return;
        if (!(error instanceof NoNetwork)) this.fail(error);
        await sleep(3000, signal).catch(() => {});
      }
    }
  }

  // The take flow, in the wasm.

  private dispatch(event: FlowEvent): void {
    if (
      !this.stored.token ||
      this.snapshot.phase === "linking" ||
      this.snapshot.phase === "booting"
    ) {
      this.log("flow", `${JSON.stringify(event)} ignoré : pas encore lié`);
      return;
    }
    const now = performance.now();
    const unix = this.clock
      ? Math.floor((this.clock.serverMs + now - this.clock.at) / 1000)
      : null;
    const claim = this.claimKey
      ? { site: location.origin, key: this.claimKey }
      : null;
    const effects = this.wasm.handle(event, {
      nowMs: Math.floor(now),
      unix,
      random: Math.floor(Math.random() * 2 ** 53),
      claim,
    });
    if (event.type !== "tick" || effects.length > 0) {
      this.log(
        "flow",
        `${JSON.stringify(event)} → ${effects.map((e) => e.type).join(", ") || "rien"}`,
      );
    }
    for (const effect of effects) this.apply(effect);

    clearTimeout(this.tickTimer);
    const deadline = this.wasm.deadline();
    if (deadline !== null) {
      this.tickTimer = setTimeout(
        () => this.dispatch({ type: "tick" }),
        Math.max(0, deadline - performance.now()) + 5,
      );
    }
  }

  private apply(effect: Effect): void {
    switch (effect.type) {
      case "show":
        if (effect.screen.type !== "main") {
          // The about page shows the terminal's readings as they are now.
          this.wasm.setDeviceInfo(this.deviceInfo());
          return this.show({ type: "flow", screen: effect.screen });
        }
        // After a take, the main screen shows the new stock: fetch it now.
        if (this.stored.queue.length > 0 && this.snapshot.network) {
          void this.sync().catch((error: unknown) => {
            this.fail(error);
            this.showMain();
          });
          return;
        }
        return this.showMain();
      case "beep":
        return this.beep(effect.beep);
      case "queue":
        this.stored.queue = [...this.stored.queue, effect.take];
        this.save();
        return this.update({ queue: this.stored.queue });
      case "noteUnknownBadge":
        if (!this.stored.unknownBadges.includes(effect.uid))
          this.stored.unknownBadges.push(effect.uid);
        return this.save();
      case "serve":
        void this.serve(effect.uid, effect.name, effect.sessionId);
        return;
    }
  }

  /** `$device` as the firmware reports it; the charge comes from the voltage in the wasm. */
  private deviceInfo(): Record<string, unknown> {
    const online = this.snapshot.network;
    return {
      unix: Math.floor(
        ((this.clock?.serverMs ?? Date.now()) +
          (this.clock ? performance.now() - this.clock.at : 0)) /
          1000,
      ),
      board: { name: "Simulateur XIAO", simulated: true },
      pins: {
        left: 5,
        right: 8,
        buzzer: 44,
        nfcSda: 41,
        nfcScl: 42,
        battery: 6,
      },
      firmware: { version: "web", build: "terminal virtuel" },
      site: globalThis.location?.host ?? null,
      device: this.state ? { id: this.state.device.id, name: this.state.device.name } : null,
      chip: { model: "Wasm", id: "navigateur" },
      wifi: {
        rssi: online ? this.sensors.wifiRssi : null,
        ssid: online ? "navigateur" : null,
      },
      battery: { millivolts: this.sensors.batteryMv, usb: this.sensors.usb },
      uptimeMinutes: Math.floor(performance.now() / 60_000),
    };
  }

  /** "Servi": the site serves the session for this badge, as the firmware does. */
  private async serve(uid: string, name: string, sessionId: string | null): Promise<void> {
    try {
      const response = await this.api("POST", "/api/device/serve", {
        json: { sessionId, badgeUid: uid },
      });
      const reply = (await response.json()) as ServeResponse;
      if (reply.reason) {
        this.beep("error");
        this.show({ type: "error", title: "Pas servi", detail: "Ce badge n'est relié à aucun compte." });
        return;
      }
      this.beep("accepted");
      this.show({ type: "flow", screen: { type: "served", name, count: reply.served } });
      // The next main screen shows the stock without the served preparation.
      await this.sync();
    } catch (error) {
      this.log("flow", `serve: ${error instanceof Error ? error.message : String(error)}`);
      this.beep("error");
      this.show({ type: "error", title: "Pas servi", detail: "Le site ne répond pas : réessaie dans un instant." });
    }
  }

  private wasmIdle(): boolean {
    return this.wasm.deadline() === null;
  }

  // The panel.

  private show(view: View): void {
    this.display(this.wasm.render(view), view);
  }

  private restoreApp(): void {
    this.appLoaded = false;
    if (this.stored.appMode === "mate") return;
    if (this.stored.appMode === "showcase") {
      this.wasm.loadShowcase();
      this.wasm.restoreApp(this.stored.showcaseData ?? {});
      if (this.state) this.wasm.updateApp("showcase", this.state);
      this.appLoaded = true;
      return;
    }
    if (this.state?.appUrl && this.stored.appBytes) {
      try {
        this.wasm.loadApp(Uint8Array.from(this.stored.appBytes));
        this.wasm.restoreApp(this.stored.appData ?? {});
        this.appLoaded = true;
      } catch {
        this.stored.appBytes = undefined;
        this.stored.appData = undefined;
      }
    }
  }

  private async fetchAppResource(id: string, path: string): Promise<void> {
    const value =
      path === "/api/device/state"
        ? this.state
        : await (await this.api("GET", path)).json();
    this.wasm.updateApp(id, value);
    this.cacheCurrentApp();
  }

  private async refreshAppImages(): Promise<void> {
    if (!this.appLoaded || !this.snapshot.network) return;
    const wasm = this.wasm;
    const signal = this.run.signal;
    for (const request of wasm.imageRequests()) {
      const key = JSON.stringify(request);
      if (this.pendingImages.has(key)) continue;
      this.pendingImages.add(key);
      try {
        const bytes = await downloadImage(
          request.src,
          this.stored.token,
          signal,
        );
        if (signal.aborted || this.wasm !== wasm || !this.appLoaded) return;
        wasm.updateImage(request, bytes);
        this.cacheCurrentApp();
        this.save();
      } catch (error) {
        if (!signal.aborted)
          this.log(
            "error",
            `Image indisponible : ${error instanceof Error ? error.message : String(error)}`,
          );
      } finally {
        this.pendingImages.delete(key);
      }
    }
  }

  private showMain(): void {
    if (this.pendingApp && this.wasmIdle()) {
      const next = this.pendingApp;
      this.pendingApp = null;
      this.selectApp(next);
      return;
    }
    this.wasm.setDeviceInfo(this.deviceInfo());
    if (this.appLoaded) {
      const theme = (
        this.wasm.cacheApp().local as { theme?: DeviceTheme } | undefined
      )?.theme;
      if (theme) this.update({ theme });
      this.display(this.wasm.renderApp(), "main");
    } else if (this.state)
      this.display(
        this.wasm.render({
          type: "main",
          state: this.state,
          offline: this.snapshot.phase === "offline",
        }),
        "main",
      );
  }

  private display(bits: Uint8Array, view: View | "main"): void {
    this.view = view;
    const due =
      this.partials >= FULL_EVERY ||
      (this.lastFull !== null && Date.now() - this.lastFull > FULL_AFTER_MS);
    const before = this.snapshot.bits;
    const turned = before ? flipped(before, bits) : 0;
    if (!(this.lastFull === null || (view === "main" && due)) && turned === 0) return;
    // As on the terminal: a new screen takes the fast full refresh, an update stays partial.
    const full =
      this.lastFull === null ||
      (view === "main" && due) ||
      refreshKind(turned, this.ghost, 800, 480) === "full";
    if (full) {
      this.partials = 0;
      this.ghost = 0;
      this.lastFull = Date.now();
    } else {
      this.partials += 1;
      this.ghost += turned;
    }
    this.update({
      bits,
      refreshes: this.snapshot.refreshes + 1,
      refresh: full ? "full" : "partial",
    });
    if (this.stored.token && this.snapshot.network) void this.uploadFrame(bits);
  }

  /** Reports the panel to the site's console; only the latest frame matters. */
  private async uploadFrame(bits: Uint8Array): Promise<void> {
    if (this.frameUpload.busy) {
      this.frameUpload.next = bits;
      return;
    }
    this.frameUpload.busy = true;
    try {
      await this.api("PUT", "/api/device/frame", { body: bits, quiet: true });
    } catch (error) {
      if (!(error instanceof NoNetwork)) this.fail(error);
    } finally {
      this.frameUpload.busy = false;
      const next = this.frameUpload.next;
      this.frameUpload.next = null;
      if (next) void this.uploadFrame(next);
    }
  }

  // Plumbing.

  private async api(
    method: string,
    path: string,
    options: {
      json?: unknown;
      body?: Uint8Array;
      headers?: Record<string, string>;
      auth?: boolean;
      signal?: AbortSignal;
      /** Polls and frames would drown the log. */
      quiet?: boolean;
      /** A 4xx is an answer, not a failure: the link token endpoint speaks RFC 8628 errors. */
      errors?: boolean;
    } = {},
  ): Promise<Response> {
    if (!this.snapshot.network) throw new NoNetwork("pas de réseau");
    const headers: Record<string, string> = { ...options.headers };
    if (options.auth !== false && this.stored.token)
      headers.Authorization = `Bearer ${this.stored.token}`;
    if (options.json !== undefined)
      headers["Content-Type"] = "application/json";
    if (options.body) headers["Content-Type"] = "application/octet-stream";
    const response = await fetch(path, {
      method,
      headers,
      body:
        options.json !== undefined
          ? JSON.stringify(options.json)
          : (options.body as BodyInit | undefined),
      signal: options.signal,
      cache: "no-store",
    });
    if (!options.quiet || !response.ok)
      this.log("http", `${method} ${path.split("?")[0]} → ${response.status}`);
    if (response.status === 401 && options.auth !== false) {
      this.log(
        "error",
        "Jeton refusé : l'appareil a été délié, retour à la liaison",
      );
      this.stored = { ...this.stored, token: null };
      this.save();
      this.update({ linked: null });
      setTimeout(() => this.restart(), 0);
      throw new Unlinked();
    }
    if (
      !response.ok &&
      response.status !== 304 &&
      !(options.errors && response.status < 500)
    ) {
      throw new Error(`${method} ${path.split("?")[0]} → ${response.status}`);
    }
    return response;
  }

  private fail(error: unknown): void {
    if (
      error instanceof Unlinked ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      return;
    this.update({ phase: "offline" });
    if (this.wasmIdle() && this.state) this.showMain();
    if (!(error instanceof NoNetwork))
      this.log("error", error instanceof Error ? error.message : String(error));
  }

  private log(kind: LogEntry["kind"], text: string): void {
    const entry = { id: ++this.logId, at: Date.now(), kind, text };
    this.update({
      logs: [...this.snapshot.logs.slice(-(MAX_LOGS - 1)), entry],
    });
  }

  private update(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private linkedInfo(): Snapshot["linked"] {
    const { token, deviceId, deviceName, officeName } = this.stored;
    return token && deviceId && deviceName && officeName
      ? { deviceId, deviceName, officeName }
      : null;
  }

  private load(): Stored {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) return JSON.parse(raw) as Stored;
    } catch {
      // Private window or blocked storage: start fresh.
    }
    return this.blank();
  }

  private blank(): Stored {
    return {
      hardwareId: `sim-${randomHex(4)}`,
      token: null,
      deviceId: null,
      deviceName: null,
      officeName: null,
      queue: [],
      unknownBadges: [],
    };
  }

  private save(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.stored));
    } catch {
      // Nothing to do: the device keeps running from memory.
    }
  }
}
import { VirtualGpio, flipped, refreshKind } from "@matecrew/device-ui/emulator";
