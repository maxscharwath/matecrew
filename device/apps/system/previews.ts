import { definePreviews } from "@matecrew/device-ui/preview";

/** The log at each stage of a start, as `ui::boot::BootLog` sends it: keys and parameters. */
const done = (key: string, params: Record<string, string> = {}) => ({ key, params, state: "done" });
const run = (key: string, params: Record<string, string> = {}) => ({ key, params, state: "run" });
const logs = [
  [done("screenReady"), run("reader")],
  [done("screenReady"), done("readerReady", { version: "1.6" }), run("wifiJoining", { ssid: "Office" })],
  [done("screenReady"), done("readerReady", { version: "1.6" }), done("wifiJoined", { ssid: "Office", rssi: "-62" }), done("siteReady", { host: "matecrew.vercel.app" }), run("apps")],
  [done("readerReady", { version: "1.6" }), done("wifiJoined", { ssid: "Office", rssi: "-62" }), done("siteReady", { host: "matecrew.vercel.app" }), done("mateLoaded"), done("allReady")],
];
const offline = [done("screenReady"), done("readerReady", { version: "1.6" }), { key: "wifiOffline", params: {}, state: "fail" }, done("siteReady", { host: "matecrew.vercel.app" }), run("apps")];

/** Boot logs as `ui::boot` drives them, and the notification layer with a toast. */
export const previews = definePreviews({
  ...Object.fromEntries(
    logs.map((lines, i) => {
      const finished = lines.filter((l) => l.state !== "run").length + (i === 3 ? 1 : 0);
      return [
        `boot-${i}`,
        { screen: "boot", data: { boot: { title: "matécrew", progress: Math.round((finished * 100) / 6), lines, step: `0${finished} / 06` } } },
      ];
    }),
  ),
  "boot-offline": {
    screen: "boot",
    description: "A start without Wi-Fi",
    data: { boot: { title: "matécrew", progress: 66, lines: offline, step: "04 / 06" } },
  },
  notification: {
    screen: "notification",
    description: "System toast over any screen",
    events: [{ kind: "notify", message: "Synchronisation terminée" }],
  },
  pairing: {
    screen: "notification",
    description: "The code a computer asks for while it pairs over Bluetooth",
    data: { pairing: { first: "482", last: "913" } },
  },
});
