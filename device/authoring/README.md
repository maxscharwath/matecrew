# Device UI SDK

Author a device application in TSX. Compile it to `.dui` bytecode. Rust owns navigation, state, text measurement, charts, image decoding and pixels on the device. ESP-IDF and the browser simulator execute the same engine. The server supplies data and assets.

The SDK lives in `device/authoring`; its package entry is `@matecrew/device-ui` (currently private and unpublished). Repository examples import it by relative path. It is a build-time DSL, with no React/DOM/CSS or JavaScript VM on the device.

## Run the apps

From the repository root:

```sh
bun run device:ui                         # compile maté, Showcase and examples
bun run device:preview                    # render actual device frames to device/sim/out
bun test tests/device                     # compiler + shipped Wasm + virtual host integration
bun device/authoring/cli.ts app.tsx --check
bun device/authoring/cli.ts app.tsx app.dui
```

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
/** @jsxImportSource ./device/authoring */
import { Screen, Button, useBuzzer } from "./device/authoring";

export default function App() {
  const buzzer = useBuzzer();
  return (
    <Screen width={400} height={240}>
      <Button x={8} y={208} width={140} height={32}
        input="left" label="Tester"
        onPress={() => buzzer.beep("success")} />
    </Screen>
  );
}
```

`onPress` accepts an action or a function **returning** an action. The compiler calls that function to obtain a declarative instruction; Rust emits the instruction on **every** press. Tones are `key`, `success`, and `error`; the firmware plays the piezo, while the simulator uses its sound adapter. Callbacks returning `void`, arbitrary runtime closures, `async` functions and arbitrary TypeScript execution are not supported. A callback can also return a state setter, navigation action or fetch action.

`input="left"` names a hardware input without tying the UI to a GPIO or a pixel coordinate. The host maps physical or remote events into `runtime.input("left")`. On our XIAO ESP32-S3, left is GPIO 5 (D4), right is GPIO 8 (D9), and buzzer is GPIO 44 (D7). Existing coordinate-based apps still work.

## Navigation

```tsx
import { Screen, Router, Route, Button, useRouter } from "./device/authoring";

function Home() {
  const router = useRouter<"home" | "settings">();
  return <Button width={100} height={20} input="right"
    label="Settings" onPress={() => router.push("settings")} />;
}
function Settings() {
  const router = useRouter<"home" | "settings">();
  return <Button width={100} height={20} input="left"
    label="Back" onPress={() => router.back()} />;
}
export default function App() {
  return <Screen width={400} height={240}>
    <Router width={400} height={240} initial="home">
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
const [theme, setTheme] = useDeviceTheme("macos");
const info = useDeviceInfo();

<Text width={140} height={16} value={api("office.name", "Offline")} />
<Text width={30} height={16} value={info("pins.buzzer", "—")} />
<Button width={80} height={18} label="80 %" onPress={() => setAmount(80)} />
<Button width={80} height={18} label="Reload" onPress={{ kind: "fetch", resource: "stock" }} />
<Button width={80} height={18} label="Dark" onPress={() => setTheme("dark")} />
```

API hooks compile to same-origin resource descriptors. The host schedules them when awake, performs authenticated requests and updates the resource. `refreshMs` is a minimum interval checked on host ticks, not a background JavaScript timer. Failed requests retain cached data. `When` consumes boolean bindings; `List` provides an `item()` binding scope.

`useDeviceInfo` reads host-supplied `$device` metadata, such as `board.name`, `pins.left`, `pins.right`, `pins.buzzer`, `wifi.rssi`, and `battery.millivolts`. Field availability depends on the board adapter. The simulator marks itself as simulated. Actual battery ADC measurement is still pending, so the physical host supplies null for battery voltage. This hook does not change pin configuration or provide general GPIO read/write access.

Themes are `flipper`, `macos`, and `dark`; geometry remains deterministic while fonts, corners and monochrome palette change. Declare `useDeviceTheme` once at the application root when sharing it between routes.

## Composable UI and charts

The composition is inspired by [shadcn cards](https://ui.shadcn.com/docs/components/base/card) and [Recharts](https://recharts.github.io/en-US/api/Line/). Components are ordinary TSX source files, with explicit dimensions suitable for small devices.

```tsx
<Card width={192} height={96}>
  <CardHeader x={6} y={4} width={180} height={28}>
    <CardTitle width={180} value="This week" />
    <CardDescription width={180} value="Rendered on your device" />
  </CardHeader>
  <CardContent x={6} y={35} width={180} height={56}>
    <LineChart width={180} height={56} data={api("history")} xKey="day">
      <Line dataKey="taken" name="Taken" />
      <Line dataKey="returned" name="Returned" stroke="dashed" />
    </LineChart>
  </CardContent>
</Card>
```

`LineChart`, `BarChart`, `AreaChart` and `ComposedChart` accept `Line`, `Bar`, and `Area` children. Data is an array of records. Every series shares an automatically calculated nonnegative domain; supply `max` for a fixed upper bound. Up to four series and the first 64 samples are drawn. Missing, negative and nonnumeric samples form gaps. `axes`, `grid`, `legend` and `xKey` control annotations. Strokes are `solid`, `dotted` and `dashed`; areas and patterned bars remain distinguishable on a one-bit screen. This is a device chart API, not full Recharts compatibility: no browser tooltips, animations or runtime formatters.

Other kit components include `DeviceChrome`, `DeviceFooter`, `KeyBar`, `FeedbackCard`, `MetricHero`, `MetricCompact`, named icon components from Pixelarticons and Streamline Pixel. Customize their source or compose the low-level `Group`, `Row`, `Column`, `Card`, `Text`, `Button`, `Progress`, `Qr`, `Image`, `List` and `When` primitives.

## Web images

```tsx
<Image x={4} y={20} width={108} height={60}
  src="https://cdn.example.com/photo.png?v=2" fit="cover" />
<Image width={48} height={48} src={api("avatarUrl")} fit="contain" />
```

The host downloads the original bytes; Rust decodes, fits, composites transparency over white and dithers them locally. Supported sources are HTTPS URLs and same-origin `/paths`. External requests carry no device token or cookies; redirects are rejected. The browser simulator needs the image server to allow CORS. The firmware does not use a server image proxy.

Initial support: non-interlaced PNG, including palette, transparency, grayscale and 16-bit inputs; at most 512 × 512 source pixels and 64 KiB downloaded bytes. The destination is at most 256 × 256 logical pixels. JPEG, WebP, SVG and animated PNG are not supported. A stable placeholder appears during loading/failure. The packed cache holds at most eight images and 16 KiB of pixel data. Image URLs identify cached assets; change the URL/version query to refresh. Host storage can impose a smaller persistence budget (8 KiB for the current terminal app cache).

## Source layout

- `jsx-runtime.ts`, `types.ts`: typed build-time components, bindings and actions.
- `components/`: independently editable kit, router, card and chart components.
- `icons/`: generated named components, each containing its own packed sprite.
- `art/`: catalogue data and upstream licenses; no hand-drawn icons.
- `binary.ts`, `writer.ts`, `limits.ts`: bounded binary encoder and shared protocol constraints.
- `cli.ts`, `build.ts`: standalone build command and deterministic artifact generation.
- `../engine/src/scene/`: device rendering, validation, chart drawing and input resolution.
- `../engine/src/runtime/`: image caching and persistent navigation.

The compiler emits a string-interned binary. API/cache payloads remain JSON; layouts do not. SDK package publication, commercial licensing, additional pixel formats, `no_std`, arbitrary runtime TypeScript, route parameters and general GPIO/NFC subscriptions remain separate work.


## Icons: direct named imports

```tsx
import { WifiIcon, CreditCardIcon } from "@matecrew/device-ui/icons/pixelarticons";
import { FoodDrinkCoffeeIcon } from "@matecrew/device-ui/icons/streamline-pixel";

<WifiIcon x={16} y={40} size={24} />
<CreditCardIcon x={56} y={40} size={24} />
<FoodDrinkCoffeeIcon x={96} y={40} size={21} />
```

`bun run device:ui` automatically runs `device:icons`: pinned Iconify SVGs become
packed 1-bit sprites at build time. All 1,308 Pixelarticons names (including legacy
icons and two aliases) and 662 Streamline Pixel names have named exports. Only
components actually used in a screen enter its DUI1 binary: 72 pixel bytes for a
24 × 24 icon, 56 for a recovered 21 × 21 Streamline icon, plus node metadata. No SVG parser, Iconify
JSON or JavaScript runtime is deployed to the device.

Open [the offline catalogue](catalog.html) to search both collections and copy a
named import. Kebab-case names become PascalCase plus `Icon`; numeric names use
an `Icon` prefix (for example `Icon4g`). Prefer native sizes (24 for Pixelarticons, 21 for Streamline) or integer
multiples. Arbitrary boxes preserve aspect ratio and snap magnification to a
whole pixel scale, centered in the box, rather than stretching pixels unevenly.
A smaller box uses reciprocal-integer sampling and necessarily loses detail.

Credits: Pixelarticons by Gerrit Halfmann (MIT), Streamline Pixel by Streamline
(CC BY 4.0). SVGs are converted to monochrome bitmaps. Include the source links,
license notices and modification notice in [art/licenses](art/licenses/README.md)
when distributing your app, firmware or SDK.

## Panel layout and physical controls

The bundled maté and Showcase layouts use **400 × 240 logical pixels**, rendered
at 2× on the 800 × 480 panel. Text and borders are finer than the old 200 × 120 /
4× layout. Other apps choose their own viewport; the host fits it to the panel
with an integer scale. `KeyBar` reserves the bottom 26 logical pixels: square
bottom corners, downward press indicators, and a central RFID marker. Left/right
hardware bindings and remote pointer hit testing use the same actions.

`DeviceChrome` uses a 22-pixel strip with 12 × 12 clock-adjacent Wi-Fi and battery
sprites. These compact sprites are compiled from the licensed vector paths onto
their own pixel grid, rather than shrinking the full-size catalogue bitmaps.
The terminal adapter prepares `$device.status` from real readings; an unmeasured
battery displays `—`. The separate battery percentage keeps the glyph legible.
The compact RFID import is `CreditCardIcon` from `@matecrew/device-ui/icons/system`.
That module also provides 12px `DeviceLaptopIcon`, `ChartIcon`, `ImageIcon`,
`SlidersIcon`, `DatabaseIcon`, and `CpuIcon` for compact controls. Use `MenuItem`
for menus with aligned icon and label columns; it preserves native icon pixels
and uses the same action and hit-testing system as `Button`.
The simulator labels its metadata as simulated and supplies a simulated battery
level. The clock shows office-local time at the last redraw, advancing from the
last server timestamp. No per-minute e-ink redraw is scheduled. An offline
session retains the last known timezone offset until the next sync.

Text placement uses font bounding boxes (including accents), and button labels
are centered from their actual glyph bounds. Built-in `KeyBar` and `DeviceChrome`
currently target the 400 × 240 kit; compose primitives for other viewport sizes.


### Inline buttons, notifications and dialogs

```tsx
import { Button, OverlayHost, Screen, useToast, useDialog, useBuzzer } from "@matecrew/device-ui";
import { InterfaceEssentialNotificationAlertIcon } from "@matecrew/device-ui/icons/streamline-pixel";

export default function App() {
  const toast = useToast();
  const dialog = useDialog();
  const buzzer = useBuzzer();
  return <Screen width={400} height={240}>
    <Button x={16} y={50} width={170} height={28}
      icon={InterfaceEssentialNotificationAlertIcon} label="Notification"
      onPress={() => toast.show("Synchronisation terminée", { durationMs: 5000 })} />
    <Button x={200} y={50} width={184} height={28} label="Jouer un son"
      onPress={() => dialog.confirm({
        title: "Tester le piézo ?", message: "Le son sera joué sur votre appareil.",
        confirmLabel: "Jouer", onConfirm: () => buzzer.beep("success"),
      })} />
    <OverlayHost />
  </Screen>;
}
```

Place one `OverlayHost` after the app content. Icons and labels in `Button` are centred
as a group, using native sprite pixels. Icons too large for the button are omitted;
use at least 28 logical pixels in height for Streamline icons.

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

GPIO 44 exposes a time-indexed, 50%-duty PWM signal. Tone programs live in Rust
`core::hardware`, shared by LEDC on hardware and Web Audio in the emulator. A volume
control changes speaker playback only. Muting does not change the simulated pin
signal. Browsers require a gesture to activate audio and may throttle background
tabs; this is a board-I/O simulation, not a cycle-accurate ESP32 emulator. The speaker
cannot reproduce the physical piezo's acoustic resonance exactly.

The complete Streamline collection is reconstructed from its fractional 32-unit SVG
export onto its original 21-pixel grid at build time. Every generated edge falls on
an integer pixel. No SVG parser, antialiasing or JSON icon catalogue runs on device.
