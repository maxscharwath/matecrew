# Device UI SDK

Author a device application in TSX. Compile it to `.dui` bytecode. Rust owns navigation, state, text measurement, charts, image decoding and pixels on the device. ESP-IDF and the browser simulator execute the same engine. The server supplies data and assets.

The SDK lives in `device/sdk`; its package is `@matecrew/device-ui` (private, a Bun workspace). Apps import it by package name and set `/** @jsxImportSource @matecrew/device-ui */`. It is a build-time DSL, with no React/DOM/CSS or JavaScript VM on the device.

## The `dui` command

`device/device.config.ts` lists the apps; every command finds it from the working directory or a parent. From the repository root:

```sh
bun dui build [app...]                    # compile apps to device/dist (and generated Rust registries)
bun dui check [app...]                    # fail if committed .dui or generated files are stale
bun dui dev [app...] [--port 4321]        # studio in the browser, rebuilt on each save (or `just studio` from device/)
bun dui render [app...] [--only <text>]   # every preview to PNG, a contact sheet and an HTML index in device/out
bun dui test [app...] [--update]          # compare every preview with its golden PNG in __snapshots__/
bun dui icons                             # regenerate icon modules and the offline catalogue
bun test tests/device                     # compiler + shipped Wasm + virtual host integration
```

`render`, `test` and `dev` draw with `sdk/engine.wasm`: the Rust engine alone, compiled to WebAssembly, so a preview is pixel for pixel what the panel shows. `just engine` (from `device/`) rebuilds it; `dui dev` builds it when it is missing and again on every save in `engine/`, `board/` or `engine-wasm/`.

### Studio and previews

`dui dev` serves the emulated terminal: the 800 × 480 panel with e-paper partial and full refreshes, both TTP223 touch keys (click and hold, or ← →), taps on the screen, the piezo on GPIO 6 (D5) through Web Audio, the XIAO pin table with live levels, battery and Wi-Fi sliders feeding `$device`, and a serial monitor of inputs, beeps, fetches and refreshes. A TSX save recompiles the app in a fresh process and reloads it on the panel, keeping its navigation and local state; a Rust save rebuilds the engine first. The **Previews** tab draws every preview of every app; click one to boot it on the terminal.

A preview is a named state to draw an app in. Point `previews` in `device.config.ts` at a module, or at a JSON file for previews generated elsewhere:

```ts
import { definePreviews } from "@matecrew/device-ui/preview";

const stock = { items: [{ name: "Maté Classic", stock: 36 }] };

export const previews = definePreviews({
  empty: { description: "Before the first sync" },
  stock: { cache: { stock } },
  help: { cache: { stock }, description: "After pressing Aide", events: [{ kind: "press", x: 300, y: 220 }] },
});
```

`cache` restores resources, `local` state and `$navigation`; `device` sets `$device.*`; `data` sets binding roots directly (the `view` of host-driven screens); `events` replay presses, inputs, actions, ticks and notifications; `screen` picks the export of a `screens: true` app. Without `previews`, each screen gets one preview in its initial state. In the studio, a preview's `cache` also answers the app's fetches, and its `on` map (`{ badge: "pick", right: "taken" }`) says which preview follows an app event or a badge the app does not handle itself; the badge reader is a click or B (see Badge reader).

An app entry either default-exports its root component (a routed app such as `apps/showcase`) or, with `screens: true`, exports one component per screen (`apps/mate`, `apps/system`); each screen compiles to `<out>/<name>.dui`. Compilation finishes for every screen before anything is written, and unchanged files are left untouched so Cargo can reuse its builds.

`device/apps/showcase/index.tsx` is a nine-page interactive application, with a real local navigation stack. `device/apps/mate/index.ts` is the maté screen entry point; the terminal host supplies its pairing, NFC, consumption and offline queue logic. Those business services remain separate from the generic engine.

In the web device console or virtual terminal, select **maté** or **Showcase**. Left/right controls navigate, and clicking a displayed button sends its logical coordinates to the engine. The physical terminal also accepts USB serial commands:

```text
app showcase
r
l
tap 95 85
app mate
```

The first line selects Showcase, `r`/`l` stand in for the physical keys, and `tap` activates an on-screen control at a normalized 200 × 120 transport coordinate (mapped to the app viewport). App selection, navigation and local state survive restart. Switching apps waits for a pending maté interaction to finish.

## Buttons and hardware callbacks

```tsx
/** @jsxImportSource @matecrew/device-ui */
import { Screen, Button, useBuzzer } from "@matecrew/device-ui";

export default function App() {
  const buzzer = useBuzzer();
  return (
    <Screen width={800} height={480}>
      <Button x={32} y={400} width={232} height={56}
        input="left" label="Tester"
        onPress={() => buzzer.beep("success")} />
    </Screen>
  );
}
```

`onPress` accepts an action or a function **returning** an action. The compiler calls that function to obtain a declarative instruction; Rust emits the instruction on **every** press. Tones are `key`, `success`, and `error`; the firmware plays the piezo, while the simulator uses its sound adapter. Callbacks returning `void`, arbitrary runtime closures, `async` functions and arbitrary TypeScript execution are not supported. A callback can also return a state setter, navigation action or fetch action.

`input="left"` names a hardware input without tying the UI to a GPIO or a pixel coordinate. The host maps physical or remote events into `runtime.input("left")`. On our XIAO ESP32-S3, left is GPIO 5 (D4), right is GPIO 8 (D9), and buzzer is GPIO 6 (D5). Existing coordinate-based apps still work.

## Navigation

```tsx
import { Screen, Router, Route, Button, useRouter } from "@matecrew/device-ui";

function Home() {
  const router = useRouter<"home" | "settings">();
  return <Button width={232} height={56} input="right"
    label="Settings" onPress={() => router.push("settings")} />;
}
function Settings() {
  const router = useRouter<"home" | "settings">();
  return <Button width={232} height={56} input="left"
    label="Back" onPress={() => router.back()} />;
}
export default function App() {
  return <Screen width={800} height={480}>
    <Router width={800} height={480} initial="home">
      <Route name="home"><Home /></Route>
      <Route name="settings"><Settings /></Route>
    </Router>
  </Screen>;
}
```

The router provides `push`, `replace`, `back`, `reset`, `current` and `canGoBack`. The latter two are bindings, not JavaScript values. Back at the root is a no-op. One router supports up to 16 routes and a 16-entry stack; pushing beyond the limit is a no-op. Unknown destinations fail compilation. Local state and resources are app-scoped, with unique names shared across routes, and survive navigation. Route parameters, nested routers and per-entry state scopes are not provided yet.

## Data, state, themes and device info

```tsx
const api = useDeviceData("stock", "/api/device/state", {
  refreshMs: 120_000,
  onWake: true,
});
const [amount, setAmount] = useDeviceState("amount", 25);
const [theme, setTheme] = useDeviceTheme("paper");
const info = useDeviceInfo();

<Text width={140} height={16} value={api("office.name", "Offline")} />
<Text width={30} height={16} value={info("pins.buzzer", "--")} />
<Button width={80} height={18} label="80 %" onPress={() => setAmount(80)} />
<Button width={80} height={18} label="Reload" onPress={{ kind: "fetch", resource: "stock" }} />
<Button width={80} height={18} label="Dark" onPress={() => setTheme("dark")} />
```

API hooks compile to same-origin resource descriptors. The host schedules them when awake, performs authenticated requests and updates the resource. `refreshMs` is a minimum interval checked on host ticks, not a background JavaScript timer. Failed requests retain cached data. `When` consumes boolean bindings; `List` provides an `item()` binding scope.

`useDeviceInfo` reads host-supplied `$device` metadata: `board.name`, `pins.*`, `firmware.version`,
`firmware.build`, `firmware.commit`, `firmware.slot` (the OTA slot), `site`, `device.id`,
`device.name`, `chip.model`, `chip.id` (the eFuse base MAC), `wifi.rssi`, `wifi.ssid`, `wifi.ip`,
`wifi.mac`, `battery.millivolts`, `battery.percent`, `battery.usb`, `battery.charging`,
`battery.low`, `uptimeMinutes`, `clock`, `locale`. The terminal reads the battery on D5 (ADC1, the
1 MΩ / 1 MΩ divider undone; `DIVIDER_PERMILLE` in `core/src/power.rs` calibrates it) and turns the
voltage into a charge on a LiPo curve. "On USB" means a USB host answers on the USB-Serial-JTAG: a
computer is seen, a wall charger is not (it would take a VBUS divider on D6). The simulator marks
itself as simulated; the studio's sensors (battery, USB, Wi-Fi) drive these fields live. This hook
does not change pin configuration or provide general GPIO read/write access.

Themes are `paper` (the default: the native kit), `dark` (paper with ink and paper swapped; QR codes stay black on white), and the older 2× looks `flipper` and `macos`. Kit components pin their type and radii, so on kit screens the light themes agree and `dark` only inverts; themes still change the role fonts of bare `Text` and `Button`. Declare `useDeviceTheme` once at the application root when sharing it between routes.

## The native kit

Every bundled app draws at the panel's **native 800 × 480**, one pixel per pixel (0.2 mm), in the
`paper` theme: a Univers-like grotesque, hairlines, dithered greys and soft radii. The kit reads like
shadcn/ui: compound components, content in children, props only for a variant or a size. Its source
is in `kit/`, small enough to read and change.

```tsx
/** @jsxImportSource @matecrew/device-ui */
import { Screen, StatusBar, Main, Keys, Key, Card, Stat, StatLabel, StatValue, HStack, Spark, bind } from "@matecrew/device-ui";

export default function Stock() {
  return (
    <Screen>
      <StatusBar>Lausanne</StatusBar>
      <Main direction="row" gap={24}>
        <Card width={{ fill: 2 }}>
          <Stat>
            <StatLabel>En stock</StatLabel>
            <StatValue size="xl">{bind("stock.count", 0)}</StatValue>
          </Stat>
          <Spark value={bind("stock.week", [])} max={50} height={96} />
        </Card>
        <Card variant="sunken" width="fill">…</Card>
      </Main>
      <Keys reader>
        <Key side="left" primary onPress={{ kind: "emit", name: "take" }}>Prendre</Key>
        <Key side="right" onPress={{ kind: "emit", name: "mine" }}>Mon compte</Key>
      </Keys>
    </Screen>
  );
}
```

**Layout** is a flex engine on the device: sizes are pixels, `"fill"`, `{ fill: weight }`,
`{ percent }` or content-sized by default; `Stack`, `HStack`, `VStack`, `Group`, `Card` and `Surface`
take `direction`, `align` (`start` `center` `end` `stretch`), `justify` (`start` `center` `end`
`between` `around` `evenly`), `gap` and `padding`. `Spacer` takes the free space. Hidden `When`/`Show`
children take no room. Text centres on its capitals, not its box (the box keeps room for accents and
descenders), so an icon beside a label, or a figure in a disc, sits optically centred.

**Tokens** (`kit/tokens.ts`): 32 px margins, an 8 px unit, the status bar above y = 56, the key tabs
from y = 424, the keys under x = 130 and 670, the badge reader under x = 400. Radii 16 (cards),
12 (controls); dithered tones `faint` 12 %, `light` 25 %, `medium` 50 %.

**Type**: `H1`–`H4`, `Lead`, `P`, `Large`, `Small`, `Muted`, `Footnote` (11 px), `Label` (spaced
capitals), `Num` (Logisoso figures, `xs` to `2xl`; `lg` and up hold digits and `+ - . , : /` only).
Words are OWT's faces, as on owt.swiss: Space Grotesk for the bold titles (`H1`–`H4`: bold
`grotesk` from 20 px), Montserrat for the rest. Sizes keep the ladder (and line heights) of the
Free Universal fonts they replaced.
Text is the children. `lines` sets how many lines before an ellipsis; `fit` shrinks the text through
its family's smaller sizes before it would ellipsize (on by default in `StatLabel` and `StatValue`).
`grotesk` text also carries `– — ‘ ’ “ ” … € • ‹ › − ← ↑ → ↓ ≤ ≥` and thin spaces; `Num` and the
`flipper` and `macos` themes' fonts carry Latin-1 only: there, write `-` rather than `—`, `'` rather
than `’`.

**Components**: `Card` (+ `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`,
`CardFooter`), `Surface` (`outline`, `hairline`, `sunken`, `tint`, `ink`, `paper`, `ghost`),
`Separator`, `Media`, `Button` and `Badge` (variants), `Alert`, `Empty` (+ `EmptyMedia`,
`EmptyTitle`, `EmptyDescription`), `Progress`, `Stat`, `Steps`, `Item` (+ `ItemMedia`, `ItemContent`,
`ItemTitle`, `ItemDescription`, `ItemActions`, `ItemValue`), `StatusBar` (title, clock, Wi-Fi and
battery from `$device.status`: charging, plugged and low battery have their own icons; or
`trailing` such as `Steps`), `Main`, `Keys` and `Key` (tabs on the bottom edge above each key),
`ReaderHint`, `BadgeInput`, `QrCode`, `OverlayHost`, `MateCrewMark`, `Logo`. Ink surfaces turn their
content to paper by themselves.

**Charts**: `LineChart`, `BarChart`, `AreaChart` and `ComposedChart` take `Line`, `Bar` and `Area`
children and data bound from the host (`data={view("days")}`). `stacked` piles bar series in one
column per category, solid, 50 %, 25 % and 12 % from the bottom. Axis labels sit under each bar, as
many as fit. `Spark` is a sparkline.

**Logic**: `Show when` / `Switch` + `Case` + `Default` render conditionally; expressions compute on the
device (`concat`, `cond`, `eq`, `add`, `div`, `mod`, `round`, `fixed`, `upper`, `coalesce`, `pad`…, and
the `fmt` template tag); a handler may be an array of actions; setters accept bindings and
expressions (`setCount(add(count, 1))`).

**Primitives** stay available for anything the kit lacks: `Group`, `Card as Panel` (with `radius`,
`borderWidth`, `borderStyle`, `background`, `opacity` and `shadow`), `Text` (with `fontFamily`
`grotesk` or `numeric`, `fontSize`, `fontWeight`, `letterSpacing`, `fit`), `Button as Pressable`
(`variant="ghost"` draws nothing: a hit area and hardware input over your own visuals), `Image`
(`inverted` for an icon on ink), `Chart` (`weight`, `fill`), `Qr`, `List`, `When`, `Modal`.

A routed app is one scene: every route counts towards the 512-node limit.

## Translations

Messages use i18next's format. `defineMessages` takes one table per locale, the first being the
default; `useI18n(messages)` gives a `t` whose bindings translate on the device, so one bytecode
serves every office.

```ts
export const messages = defineMessages({
  fr: {
    "hello": "Salut {{name}} !",
    "stock_zero": "Épuisé", "stock_one": "{{count}} maté", "stock_other": "{{count}} matés",
    "side": "Droite", "side_left": "Gauche",
  },
  en: { "hello": "Hi {{name}}!", "stock_one": "{{count}} maté", "stock_other": "{{count}} matés", "side": "Right", "side_left": "Left" },
});
const t = useI18n(messages);
t("stock", { count: view("count") });   // plural forms by locale (fr: 0 and 1 are `one`), `_zero` for 0
t("side", { context: view("side") });   // `side_left`, else `side`
```

The locale is the app's `locale` state, else the host's `$device.locale`, else the first one. Only the
keys a screen uses go into its bytecode. Single braces are rejected at build time: interpolate with
`{{name}}`. The build turns these messages into an ICU subset the engine reads.

## Bytecode size

`dui build` writes DUIZ when it is smaller: the DUI1 bytecode compressed with a deterministic
DEFLATE (same input, same bytes, on every machine), inflated by the engine. Screens shrink by about
two thirds; `dui build` prints both sizes.

## Icons and art

```tsx
import { WifiIcon, NfcIcon } from "@matecrew/device-ui/icons/lucide";

<WifiIcon x={16} y={40} />                       {/* 24 px, 2 px strokes */}
<NfcIcon x={56} y={32} size={48} strokeWidth={3} />
<WifiIcon x={120} y={40} size={24} inverted />   {/* paper on an ink surface */}
```

The icons are [Lucide](https://lucide.dev), the site's set (ISC, `icons/licenses/lucide.txt`): all
1,703 drawings as vector data, generated by `bun dui icons` from the installed `lucide-react`.
`icons/vector.ts` draws each one at compile time at the size it is used, with strokes of exactly
`strokeWidth` pixels, round caps and joins, 4 × 4 samples per pixel. It is plain TypeScript, so a
build gives the same bits on every machine. Sizes that are multiples of 24 land strokes on whole
pixels. The packed sprite goes into the bytecode as raw bytes; no SVG reaches the device.

`createArt(layers, viewBox)` builds illustrations the same way: fills (non-zero or even-odd), strokes
in viewBox units, `tone` for ordered-dither greys (`0` erases to paper), `transform` on any element.
`apps/mate/art.ts` draws the badge over the reader; `kit/brand.tsx` the mark.

The Pixelarticons and Streamline Pixel modules (`icons/pixelarticons`, `icons/streamline-pixel`,
`icons/system`) remain for older code; new screens use Lucide.

## QR codes

```tsx
<QrCode size={280} value={bind("view.qr")}>Scanne avec ton mobile</QrCode>   {/* rounded, mark in the centre, caption */}
<Qr width={112} height={112} value={url} style="dots" quiet={2} />
```

`Qr` draws on a guaranteed paper quiet zone, even in the dark theme. `style` is `square`, `dots` or
`rounded` (modules join, free corners round off); finder and alignment patterns follow it. A `logo`
sits in a cleared centre plate of at most 36 % of the side, and forces high error correction; it is
dropped rather than cover an alignment pattern. Use `logo={null}` on `QrCode` for long payloads.
The quiet zone shrinks (down to one module) when that buys bigger modules, and an encoded code is
kept between redraws of the same link.

## Badge reader

```tsx
const toast = useToast();
<BadgeInput onPress={[toast.show("Badge lu"), useBuzzer().beep("badge")]} />
<Large>{useDeviceInfo()("nfc.uid", "Aucun badge")}</Large>
```

The host fires the `badge` input when the PN532 reads a card, after putting its UID in
`$device.nfc.uid`. `beep("badge")` is the reader's sparkle (C7 E7 G7 C8), also played when the
terminal recognises a badge. In the studio, click the reader or press B (the UID is editable). The maté
screens are host-driven: there the studio follows each preview's `on` map instead
(`badge → pick`, `right → taken`…), defined with the previews in `ui/src/previews.rs`.

## Web images

```tsx
<Image x={4} y={20} width={108} height={60}
  src="https://cdn.example.com/photo.png?v=2" fit="cover" />
<Image width={48} height={48} src={api("avatarUrl")} fit="contain" />
```

The host downloads the original bytes; Rust decodes, fits, composites transparency over white and dithers them locally. Supported sources are HTTPS URLs and same-origin `/paths`. External requests carry no device token or cookies; redirects are rejected. The browser simulator needs the image server to allow CORS. The firmware does not use a server image proxy.

Initial support: non-interlaced PNG, including palette, transparency, grayscale and 16-bit inputs; at most 512 × 512 source pixels and 64 KiB downloaded bytes. The destination is at most 256 × 256 logical pixels. JPEG, WebP, SVG and animated PNG are not supported. A stable placeholder appears during loading/failure. The packed cache holds at most eight images and 16 KiB of pixel data. Image URLs identify cached assets; change the URL/version query to refresh. Host storage can impose a smaller persistence budget (8 KiB for the current terminal app cache).

## Cache

What a host keeps between restarts that the server can send again (the last state, an app's bytecode and data, the studio's choices) goes through the cache SDK: typed keys declared in one place, each saying how long it keeps (`Keep.forever` only for what works offline) and how many bytes it may take, with a checked header so an expired or damaged entry reads as missing. `device/sdk/cache` is the TypeScript package (`@matecrew/device-cache`, also `@matecrew/device-ui/cache`; memory and `localStorage` backends) and `device/cache` its Rust twin (`matecrew-cache`), which the firmware runs over NVS; `device/firmware/src/cache.rs` lists everything the terminal caches. See their READMEs for the rules.

## Source layout

- `runtime/`: typed build-time components, hooks, router, bindings, actions and protocol limits.
- `compiler/`: bounded binary encoder and deterministic file output.
- `kit/`: tokens, typography, surfaces, cards, buttons, feedback, items, device chrome (status bar, keys), QR, overlays, charts, brand.
- `icons/`: `vector.ts` (the compile-time rasterizer), generated named components (Lucide as vectors; the older pixel sets as packed sprites), the offline catalogue and upstream licenses.
- `cli/`: the `dui` command; `config.ts` types `device.config.ts`.
- `tools/icons/`: the icon generator behind `dui icons`.
- `../engine/src/scene/`: device rendering, validation, chart drawing and input resolution.
- `../engine/src/runtime/`: image caching and persistent navigation.

The compiler emits a string-interned binary. API/cache payloads remain JSON; layouts do not. SDK package publication, commercial licensing, additional pixel formats, `no_std`, arbitrary runtime TypeScript, route parameters and general GPIO/NFC subscriptions remain separate work.


## Panel layout and physical controls

Apps choose their viewport; the host fits it to the panel with an integer scale, so an 800 × 480
app draws 1:1. `Keys` and remote taps share the same actions: the left and right keys, a tap on
a tab, and the console's normalized 200 × 120 transport coordinates all reach the same ghost button.
The terminal adapter prepares `$device.status` (24 px Lucide Wi-Fi and battery sprites, battery
text) from real readings; the studio and `dui render` add the same decoration to simulated
readings. The clock shows office-local time at the last redraw, advancing from the last server
timestamp; no per-minute e-ink redraw is scheduled.

### Inline buttons, notifications and dialogs

```tsx
import { PushButton, OverlayHost, Screen, useToast, useDialog, useBuzzer } from "@matecrew/device-ui";
import { BellIcon } from "@matecrew/device-ui/icons/lucide";

export default function App() {
  const toast = useToast();
  const dialog = useDialog();
  const buzzer = useBuzzer();
  return <Screen width={800} height={480}>
    <PushButton x={32} y={96} width={344} icon={BellIcon} label="Notification"
      onPress={toast.show("Synchronisation terminée", { durationMs: 5000 })} />
    <PushButton x={424} y={96} width={344} label="Jouer un son"
      onPress={dialog.confirm({
        title: "Tester le piézo ?", message: "Le son sera joué sur votre appareil.",
        confirmLabel: "Jouer", onConfirm: buzzer.beep("success"),
      })} />
    <OverlayHost />
  </Screen>;
}
```

Place one `OverlayHost` after the app content. A toast is an ink pill above the key tabs; a
dialog dims the screen, asks its question in a card and relabels both key tabs.

A toast replaces the previous toast and expires on the monotonic device clock,
independently of network requests. Duration: 1–60 seconds; text: 1–256 UTF-8 bytes.
The host can also call Rust `Runtime::notify` at any time. System notifications over
built-in maté screens use `ui::notifications::notify`; USB: `notify Your message`.
The web host exposes `VirtualDevice.notify(message, durationMs)`.

Dialogs block background pointer and hardware input. Left cancels, right confirms;
confirmation runs once. Dialog buttons and the physical-key hints show the same
labels. Overlay state is transient and is not restored from offline caches. These
hooks compile portable actions; callbacks are not arbitrary JavaScript executed on
the MCU. Toast actions play the short `notification` tone. The buzzer also supports
`key`, `success` and `error`.

### GPIO and audio fidelity in the web simulator

The simulated TTP223 inputs drive GPIO 5/8 high and release to their pull-down state.
The ESP32 and Wasm share `core::hardware::TouchKeys`, sampled every 20 ms. Held keys
produce one rising edge; release/repress and simultaneous keys work independently.
Keyboard auto-repeat is ignored. Blur/hidden-tab releases inputs. Remote console
commands remain discrete events; local simulator buttons use the GPIO path.

GPIO 6 (D5) exposes a time-indexed, 50%-duty PWM signal. Tone programs live in Rust
`core::hardware`, shared by LEDC on hardware and Web Audio in the emulator. A volume
control changes speaker playback only. Muting does not change the simulated pin
signal. Browsers require a gesture to activate audio and may throttle background
tabs; this is a board-I/O simulation, not a cycle-accurate ESP32 emulator. The speaker
cannot reproduce the physical piezo's acoustic resonance exactly.
