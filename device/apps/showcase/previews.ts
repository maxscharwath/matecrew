import { definePreviews, type Preview } from "@matecrew/device-ui/preview";
import { pages } from "./shared";

const device = {
  board: { name: "Simulateur XIAO", simulated: true },
  pins: { left: 5, right: 8, buzzer: 6 },
  wifi: { rssi: -55 },
  battery: { percent: 78 },
  clock: "10:42",
};
const page = (name: string, extra: Preview = {}): Preview => ({
  device,
  cache: {
    showcase: { office: { name: "Lausanne · données API" } },
    $navigation: { stack: name === "home" ? ["home"] : ["home", name] },
  },
  images: { "/device/streamline-coffee.png": "../../../public/device/streamline-coffee.png" },
  ...extra,
});

/** One preview per page, plus the overlays and the badge the hardware page reacts to. */
export const previews = definePreviews({
  ...Object.fromEntries(pages.map((name) => [name, page(name)])),
  toast: page("hardware", {
    description: "Hardware page: notification",
    events: [{ kind: "tick", ms: 100 }, { kind: "press", x: 150, y: 238 }],
  }),
  dialog: page("hardware", {
    description: "Hardware page: confirmation dialog",
    events: [{ kind: "tick", ms: 100 }, { kind: "press", x: 400, y: 238 }],
  }),
  badge: page("hardware", {
    description: "Hardware page: a badge on the reader",
    device: { ...device, nfc: { uid: "04A1B2C3D4E5F6", reader: "PN532" } },
    events: [{ kind: "tick", ms: 100 }, { kind: "input", name: "badge" }],
  }),
  "logic-en": page("logic", { description: "Logic page, office in English", device: { ...device, locale: "en" } }),
  dark: page("home", { description: "Home, dark theme", theme: "dark" }),
});
