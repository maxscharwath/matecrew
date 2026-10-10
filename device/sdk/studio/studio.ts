/** dui studio: the emulated terminal and every preview, live-reloaded by `dui dev`. */
import { Engine, type Frame } from "../preview/engine";
import { EmulatedBoard, REFRESH_MS, decorate, type LogEntry, type Refresh } from "../emulator";
import { batteryMillivolts } from "../emulator/status";
import type { Preview } from "../preview";
import type { Bundle } from "../cli/bundle";
import { Cache, Keep, key, localStorageBackend } from "../cache";

const PAPER = [0xf4, 0xf2, 0xec];
const INK = [0x1d, 0x1d, 0x1f];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  app: $<HTMLSelectElement>("app"),
  preview: $<HTMLSelectElement>("preview"),
  invert: $<HTMLButtonElement>("invert"),
  reset: $<HTMLButtonElement>("reset"),
  status: $<HTMLOutputElement>("status"),
  panel: $<HTMLCanvasElement>("panel"),
  busy: $<HTMLDivElement>("busy"),
  error: $<HTMLPreElement>("error"),
  pins: $<HTMLTableSectionElement>("pins"),
  log: $<HTMLOListElement>("log"),
  grid: $<HTMLDivElement>("grid"),
  battery: $<HTMLInputElement>("battery"),
  rssi: $<HTMLInputElement>("rssi"),
  offline: $<HTMLInputElement>("offline"),
  usb: $<HTMLInputElement>("usb"),
  volume: $<HTMLInputElement>("volume"),
  mute: $<HTMLInputElement>("mute"),
  badge: $<HTMLButtonElement>("badge"),
  locale: $<HTMLSelectElement>("locale"),
  uid: $<HTMLInputElement>("uid"),
};
const context = ui.panel.getContext("2d")!;

let engine: Engine;
let board: EmulatedBoard;
const bundles = new Map<string, Bundle | { error: string }>();
let view: "device" | "previews" = "device";
let inverted = false;
/** The studio's choices, kept until changed; in a private window they are not remembered. */
const choices = Cache.open(localStorageBackend({ prefix: "dui:" }));
const APP = key<string>("app").keep(Keep.forever).maxBytes(256);
const LOCALE = key<string>("locale").keep(Keep.forever).maxBytes(64);
const PREVIEW = (app: string) => key<string>(`preview:${app}`).keep(Keep.forever).maxBytes(256);

/* ---------- Data ---------- */

async function loadEngine(): Promise<Engine> {
  const bytes = await (await fetch("/engine.wasm", { cache: "no-store" })).arrayBuffer();
  return Engine.fromBytes(bytes);
}
async function loadBundle(app: string): Promise<void> {
  bundles.set(app, await (await fetch(`/api/bundle/${app}`)).json());
}
const current = () => bundles.get(ui.app.value);
const isBundle = (value: unknown): value is Bundle => !!value && !("error" in (value as object));
const decode = (base64: string) => Uint8Array.from(atob(base64), (c) => c.codePointAt(0) ?? 0);

function selected(): { bundle: Bundle; preview: Preview; bytes: Uint8Array } | null {
  const bundle = current();
  if (!isBundle(bundle)) return null;
  const preview = bundle.previews[ui.preview.value] ?? {};
  const artifact = preview.screen
    ? bundle.artifacts.find((a) => a.screen === preview.screen)
    : bundle.artifacts[0];
  return artifact ? { bundle, preview, bytes: decode(artifact.bytes) } : null;
}

/** `$device` as the board adapter reports it, from the sensor controls. */
function deviceInfo(): Record<string, unknown> {
  const now = new Date();
  return decorate({
    board: { name: "Émulateur XIAO ESP32-S3", simulated: true },
    pins: { left: 5, right: 8, buzzer: 6 },
    wifi: { rssi: ui.offline.checked ? null : Number(ui.rssi.value) },
    // The terminal sends the voltage; the charge comes from the LiPo curve, as on the device.
    battery: { millivolts: Number(ui.battery.value), usb: ui.usb.checked },
    clock: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    ...(ui.locale.value ? { locale: ui.locale.value } : {}),
  });
}

/**
 * The preview's data, where a host-driven screen carries its own `$device`: the studio's
 * sensors, clock and locale replace the recorded ones, as the terminal's live readings would.
 */
function localized(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data || typeof data.$device !== "object") return data;
  const recorded = data.$device as Record<string, unknown>;
  const live = deviceInfo();
  // The sensors set the signal; the network the preview recorded (SSID, IP, MAC) stays.
  const wifi = { ...(recorded.wifi as object), ...(live.wifi as object) };
  return { ...data, $device: decorate({ ...recorded, ...live, wifi }) };
}

/** Start the sensors where the preview puts the terminal: battery, USB and Wi-Fi. */
function sense(device: unknown): void {
  if (!device || typeof device !== "object") return;
  const { battery, wifi } = device as { battery?: Record<string, unknown>; wifi?: { rssi?: unknown } };
  if (battery) {
    const millivolts = recordedMillivolts(battery);
    if (millivolts !== null) ui.battery.value = String(millivolts);
    ui.usb.checked = battery.usb === true || battery.charging === true;
  }
  if (wifi && "rssi" in wifi) {
    ui.offline.checked = typeof wifi.rssi !== "number";
    if (typeof wifi.rssi === "number") ui.rssi.value = String(wifi.rssi);
  }
  showSensors();
}

/** The battery voltage a preview recorded, or the one its charge stands for. */
function recordedMillivolts(battery: Record<string, unknown>): number | null {
  if (typeof battery.millivolts === "number") return battery.millivolts;
  if (typeof battery.percent === "number") return batteryMillivolts(battery.percent);
  return null;
}

function showSensors(): void {
  const millivolts = Number(ui.battery.value);
  const battery = decorate({ battery: { millivolts, usb: ui.usb.checked } }).battery as { percent: number | null; charging: boolean };
  $("battery-out").textContent = `${(millivolts / 1000).toFixed(2)} V · ${battery.percent ?? "--"} %${battery.charging ? " ↑" : ""}`;
  $("rssi-out").textContent = ui.offline.checked ? "coupé" : `${ui.rssi.value} dBm`;
}

/* ---------- Panel ---------- */

function image(frame: Frame, invert = false): ImageData {
  const data = new ImageData(frame.width, frame.height);
  const row = Math.ceil(frame.width / 8);
  for (let y = 0; y < frame.height; y++)
    for (let x = 0; x < frame.width; x++) {
      const on = ((frame.bits[y * row + (x >> 3)] & (128 >> (x & 7))) !== 0) !== invert;
      const color = on ? INK : PAPER;
      const i = (y * frame.width + x) * 4;
      data.data[i] = color[0];
      data.data[i + 1] = color[1];
      data.data[i + 2] = color[2];
      data.data[i + 3] = 255;
    }
  return data;
}

let painting = 0;
/**
 * E-paper refresh: a full refresh flashes the whole panel; a partial one just shows the new
 * pixels. It draws the whole frame, identical outside the changed window, so it also ends a
 * full refresh it interrupts.
 */
function paint(frame: Frame, refresh: Refresh): void {
  const token = ++painting;
  lastRefresh = performance.now();
  const final = image(frame);
  const steps: [number, () => void][] =
    refresh.kind === "full"
      ? [
          [0, () => context.fillRect(0, 0, frame.width, frame.height)],
          [120, () => context.clearRect(0, 0, frame.width, frame.height)],
          [220, () => context.putImageData(image(frame, true), 0, 0)],
          [320, () => context.putImageData(final, 0, 0)],
        ]
      : [[0, () => context.putImageData(final, 0, 0)]];
  context.fillStyle = `rgb(${INK})`;
  if (ui.panel.width !== frame.width) {
    ui.panel.width = frame.width;
    ui.panel.height = frame.height;
  }
  for (const [at, step] of steps) setTimeout(() => token === painting && step(), at);
  ui.busy.hidden = false;
  setTimeout(() => (ui.busy.hidden = !(board?.busy() ?? false)), REFRESH_MS[refresh.kind] + 10);
}

/* ---------- Board ---------- */

function log(entry: LogEntry): void {
  const item = document.createElement("li");
  item.className = entry.kind;
  const time = document.createElement("time");
  time.textContent = (entry.at / 1000).toFixed(2).padStart(7);
  const kind = document.createElement("span");
  kind.className = "kind";
  kind.textContent = entry.kind;
  const text = document.createElement("span");
  text.textContent = entry.text;
  item.append(time, kind, text);
  ui.log.append(item);
  while (ui.log.children.length > 400) ui.log.firstChild?.remove();
  ui.log.scrollTop = ui.log.scrollHeight;
}

function createBoard(): EmulatedBoard {
  board?.stop();
  const next = new EmulatedBoard(engine, {
    frame: paint,
    log,
    fetch: (id) => selected()?.preview.cache?.[id],
    image: (src) => selected()?.preview.images?.[src],
    emit: (name) => follow(name),
  });
  next.buzzer.setVolume(Number(ui.volume.value));
  next.buzzer.setEnabled(!ui.mute.checked);
  renderPins(next);
  next.start();
  return next;
}

/**
 * Load the selected app in its preview's starting state. Only `reboot` (the Redémarrer
 * button) refreshes the whole panel; switching app or state redraws what changed.
 */
function boot(reboot = false): void {
  const chosen = selected();
  showError(current());
  if (!chosen) return;
  const { preview, bytes } = chosen;
  sense(preview.device ?? preview.data?.$device);
  try {
    board.load(bytes, {
      cache: preview.cache,
      device: decorate({ ...preview.device, ...deviceInfo() }),
      data: localized(preview.data),
      reboot,
    });
  } catch (error) {
    return showError(current(), `Chargement refusé par le moteur : ${message(error)}`);
  }
  board.setInverted(inverted);
  log({ at: performance.now(), kind: "info", text: `${reboot ? "boot" : "état"} ${ui.app.value} · ${ui.preview.value}` });
}

/**
 * Stand in for the host's flow: the preview this one names for an app event, if any. A held key
 * (`rightLong`) is the short one where the preview names nothing for it, as on the terminal.
 */
function follow(event: string): void {
  const bundle = current();
  const on = selected()?.preview.on;
  const next = on?.[event] ?? (event.endsWith("Long") ? on?.[event.slice(0, -"Long".length)] : undefined);
  if (!next || !isBundle(bundle) || !(next in bundle.previews)) return;
  // After the current effects settle, like a host answering an emit.
  setTimeout(() => {
    ui.preview.value = next;
    choices.put(PREVIEW(ui.app.value), next);
    log({ at: performance.now(), kind: "info", text: `${event} → ${next}` });
    boot();
  });
}

/** A badge on the PN532: the app's `badge` input, else the preview flow. */
function badge(): void {
  const uid = ui.uid.value.replace(/[^0-9a-f]/gi, "").toUpperCase() || "04A1B2C3D4E5F6";
  ui.badge.classList.add("held");
  setTimeout(() => ui.badge.classList.remove("held"), 180);
  if (!board.badge(uid, { ...deviceInfo(), nfc: { uid, reader: "PN532" } })) follow("badge");
}

/** Rebuilt bytecode, same running state: what a live reload does on the device. */
function hotReload(): void {
  const chosen = selected();
  showError(current());
  if (!chosen) return;
  try {
    board.reload(chosen.bytes, { data: localized(chosen.preview.data) });
  } catch (error) {
    return showError(current(), `Rechargement refusé par le moteur : ${message(error)}`);
  }
  log({ at: performance.now(), kind: "info", text: `reload ${ui.app.value} (${chosen.bytes.length} o)` });
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function showError(bundle: Bundle | { error: string } | undefined, runtime = ""): void {
  const error = (bundle && "error" in bundle ? bundle.error : "") || runtime;
  ui.error.hidden = !error;
  ui.error.textContent = error;
  ui.status.className = `status ${error ? "failed" : "ok"}`;
  if (isBundle(bundle)) {
    const size = bundle.artifacts.reduce((sum, a) => sum + a.size, 0);
    const nodes = Math.max(...bundle.artifacts.map((a) => a.nodes));
    const screens = bundle.artifacts.length > 1 ? `${bundle.artifacts.length} écrans · ` : "";
    ui.status.textContent = runtime ? "échec au chargement" : `${screens}${size.toLocaleString("fr")} o · ${nodes} nœuds`;
  } else ui.status.textContent = error ? "échec de compilation" : "";
}

/* ---------- Pins ---------- */

const rows = new Map<number, { led: HTMLElement; value: HTMLElement }>();
function renderPins(target: EmulatedBoard): void {
  ui.pins.replaceChildren();
  rows.clear();
  for (const pin of target.pins) {
    const row = ui.pins.insertRow();
    const led = document.createElement("span");
    led.className = "led";
    row.insertCell().append(led);
    row.insertCell().textContent = pin.pad;
    row.insertCell().textContent = String(pin.gpio);
    row.insertCell().textContent = pin.function;
    const value = row.insertCell();
    rows.set(pin.gpio, { led, value });
  }
}
function animatePins(): void {
  const now = performance.now();
  if (board)
    for (const pin of board.pins) {
      const row = rows.get(pin.gpio);
      if (!row) continue;
      const { high, text } = reading(pin, now);
      row.led.classList.toggle("on", high);
      row.value.textContent = text;
    }
  requestAnimationFrame(animatePins);
}

type Reading = { high: boolean; text: string };

/** What a pin's row shows: its LED and its value. */
function reading(pin: EmulatedBoard["pins"][number], now: number): Reading {
  const high = board.level(pin.gpio, now);
  switch (pin.signal) {
    case "buzzer": {
      const hz = board.gpio.frequency(now);
      return { high, text: hz ? `${hz} Hz` : "—" };
    }
    case "adc":
      return { high: false, text: `${(Number(ui.battery.value) / 2000).toFixed(2)} V` };
    case "panel":
      return panelReading(pin.gpio, now);
    case "i2c":
      return { high, text: high ? "trafic" : "—" };
    case "free":
      return { high, text: "—" };
    default:
      return { high, text: high ? "HIGH" : "LOW" };
  }
}

/** SPI clocks data at the start of a refresh; BUSY (GPIO 3) stays high until the panel settles. */
function panelReading(gpio: number, now: number): Reading {
  const busy = board.busy(now);
  if (gpio === 3) return { high: busy, text: busy ? "occupé" : "prêt" };
  const high = busy && now - lastRefresh < 60;
  return { high, text: high ? "actif" : "—" };
}
let lastRefresh = 0;

/* ---------- Previews ---------- */

function renderPreviews(): void {
  ui.grid.replaceChildren();
  for (const [app, bundle] of bundles) {
    const title = document.createElement("h2");
    title.textContent = app;
    const cards = document.createElement("div");
    cards.className = "cards";
    ui.grid.append(title, cards);
    if (!isBundle(bundle)) {
      cards.textContent = bundle.error;
      cards.className = "card failed";
      continue;
    }
    for (const [name, preview] of Object.entries(bundle.previews)) {
      const card = document.createElement("button");
      card.className = "card";
      const artifact = preview.screen
        ? bundle.artifacts.find((a) => a.screen === preview.screen)
        : bundle.artifacts[0];
      const canvas = document.createElement("canvas");
      try {
        const spec = { ...preview };
        delete spec.screen;
        delete spec.description;
        const frame = engine.render(decode(artifact!.bytes), spec);
        canvas.width = frame.width;
        canvas.height = frame.height;
        canvas.getContext("2d")!.putImageData(image(frame), 0, 0);
      } catch (error) {
        card.classList.add("failed");
        canvas.title = String(error);
      }
      const label = document.createElement("b");
      label.textContent = name;
      const description = document.createElement("span");
      description.textContent = preview.description ?? "";
      card.append(canvas, label, description);
      card.onclick = () => {
        ui.app.value = app;
        fillPreviews();
        ui.preview.value = name;
        select("device");
        boot();
      };
      cards.append(card);
    }
  }
}

/* ---------- Controls ---------- */

function fillPreviews(): void {
  const bundle = current();
  ui.preview.replaceChildren();
  if (!isBundle(bundle)) return;
  for (const name of Object.keys(bundle.previews)) ui.preview.add(new Option(name, name));
  const remembered = choices.get(PREVIEW(ui.app.value));
  if (remembered && remembered in bundle.previews) ui.preview.value = remembered;
}

function select(next: "device" | "previews"): void {
  view = next;
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-view]"))
    tab.setAttribute("aria-selected", String(tab.dataset.view === next));
  $("device-view").hidden = next !== "device";
  $("previews-view").hidden = next !== "previews";
  if (next === "previews") renderPreviews();
}

function wire(): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-view]"))
    tab.onclick = () => select(tab.dataset.view as "device" | "previews");
  ui.app.onchange = () => {
    choices.put(APP, ui.app.value);
    fillPreviews();
    boot();
  };
  ui.preview.onchange = () => {
    choices.put(PREVIEW(ui.app.value), ui.preview.value);
    boot();
  };
  ui.reset.onclick = () => boot(true);
  ui.locale.value = choices.get(LOCALE) ?? "";
  ui.locale.onchange = () => {
    choices.put(LOCALE, ui.locale.value);
    // Apps read `$device.locale`; host-driven screens carry it in their data.
    hotReload();
    board.device(deviceInfo());
  };
  ui.invert.onclick = () => {
    inverted = !inverted;
    ui.invert.setAttribute("aria-pressed", String(inverted));
    board.setInverted(inverted);
    if (!board.ready) return;
    // Polarity is the app's theme state until the engine renders inversion itself.
    board.engine.session.restore({ local: { theme: inverted ? "dark" : "flipper" } });
    board.redraw();
  };
  $("clear").onclick = () => ui.log.replaceChildren();

  // Touch keys: pointer and keyboard drive the TTP223 outputs high while held.
  for (const pad of document.querySelectorAll<HTMLButtonElement>(".pad")) {
    const side = pad.dataset.side as "left" | "right";
    const press = (down: boolean, source: string) => {
      board.touch(side, down, source);
      pad.classList.toggle("held", down);
    };
    pad.onpointerdown = (event) => {
      pad.setPointerCapture(event.pointerId);
      press(true, `pointer:${event.pointerId}`);
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const)
      pad.addEventListener(type, (event) => press(false, `pointer:${(event as PointerEvent).pointerId}`));
  }
  ui.badge.onclick = badge;
  const keys: Record<string, "left" | "right"> = { ArrowLeft: "left", ArrowRight: "right" };
  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === "text") return;
    if ((event.key === "b" || event.key === "B") && !event.repeat) return badge();
    const side = keys[event.key];
    if (!side || event.repeat || event.target instanceof HTMLSelectElement) return;
    event.preventDefault();
    board.touch(side, true, "keyboard");
    document.querySelector(`.pad[data-side="${side}"]`)?.classList.add("held");
  });
  window.addEventListener("keyup", (event) => {
    const side = keys[event.key];
    if (!side) return;
    board.touch(side, false, "keyboard");
    document.querySelector(`.pad[data-side="${side}"]`)?.classList.remove("held");
  });
  window.addEventListener("blur", () => {
    board.gpio.release();
    for (const pad of document.querySelectorAll(".pad")) pad.classList.remove("held");
  });
  // Browsers only start audio from a gesture.
  window.addEventListener("pointerdown", () => void board.buzzer.unlock(), { once: true });
  window.addEventListener("keydown", () => void board.buzzer.unlock(), { once: true });

  ui.panel.onclick = (event) => {
    const box = ui.panel.getBoundingClientRect();
    board.tap(((event.clientX - box.left) / box.width) * ui.panel.width, ((event.clientY - box.top) / box.height) * ui.panel.height);
  };

  const sensors = () => {
    showSensors();
    board?.device(deviceInfo());
    // Host-driven screens carry `$device` in their data: give them the new readings too.
    const data = selected()?.preview.data;
    if (data && typeof data.$device === "object") board?.hostData(localized(data)!);
  };
  for (const input of [ui.battery, ui.rssi, ui.offline, ui.usb]) input.oninput = sensors;
  sensors();
  const volume = () => {
    $("volume-out").textContent = `${Math.round(Number(ui.volume.value) * 100)} %`;
    board?.buzzer.setVolume(Number(ui.volume.value));
    board?.buzzer.setEnabled(!ui.mute.checked);
  };
  ui.volume.oninput = volume;
  ui.mute.onchange = volume;
  volume();
}

/* ---------- Live reload ---------- */

function listen(): void {
  const events = new EventSource("/events");
  events.addEventListener("bundle", async (event) => {
    const { app } = JSON.parse((event as MessageEvent).data) as { app: string };
    await loadBundle(app);
    if (app === ui.app.value) {
      const previous = ui.preview.value;
      fillPreviews();
      if ([...ui.preview.options].some((o) => o.value === previous)) ui.preview.value = previous;
      hotReload();
    }
    if (view === "previews") renderPreviews();
  });
  events.addEventListener("engine", async (event) => {
    const { error } = JSON.parse((event as MessageEvent).data) as { error?: string };
    if (error) return log({ at: performance.now(), kind: "error", text: error });
    const cache = board.ready ? board.engine.session.cache() : undefined;
    engine = await loadEngine();
    board = createBoard();
    boot(true);
    if (cache && board.ready) {
      board.engine.session.restore(cache);
      board.redraw();
    }
    log({ at: performance.now(), kind: "info", text: "moteur rechargé" });
  });
}

/* ---------- Start ---------- */

engine = await loadEngine();
const apps: string[] = await (await fetch("/api/apps")).json();
await Promise.all(apps.map(loadBundle));
for (const app of apps) ui.app.add(new Option(app, app));
const remembered = choices.get(APP);
if (remembered && apps.includes(remembered)) ui.app.value = remembered;
fillPreviews();
board = createBoard();
wire();
boot(true);
listen();
requestAnimationFrame(animatePins);
document.addEventListener("visibilitychange", () => document.hidden && board.gpio.release());
