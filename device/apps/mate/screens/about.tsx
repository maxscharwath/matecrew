/** @jsxImportSource @matecrew/device-ui */
import {
  Screen,
  StatusBar,
  Main,
  Keys,
  Key,
  Surface,
  OwtMark,
  Large,
  Footnote,
  Progress,
  Separator,
  HStack,
  VStack,
  and,
  bind,
  concat,
  cond,
  div,
  eq,
  fixed,
  gte,
  mod,
  mul,
  round,
  sub,
  type TextChildren,
} from "@matecrew/device-ui";
import { Facts, emit, useT } from "./shared";

/** What the host reports about itself in `$device` (device/ui/src/device_info.rs). */
const device = (key: string, fallback: unknown = null) => bind(`$device.${key}`, fallback);

/** "312 Ko" under a megabyte, "7.6 Mo" from there, in the office's language. */
function size(bytes: unknown) {
  const t = useT();
  return cond(
    gte(bytes, 1048576),
    t("about.mb", { n: fixed(div(bytes, 1048576), 1) }),
    t("about.kb", { n: round(div(bytes, 1024)) }),
  );
}

/** How full one memory is (`$device.memory.<name>`): its name, what is left, a bar of what is used. */
function Gauge({ name, children }: Readonly<{ name: string; children?: TextChildren }>) {
  const t = useT();
  const used = device(`memory.${name}.used`, 0);
  const total = device(`memory.${name}.total`, 0);
  return (
    <VStack width="fill" gap={2}>
      <HStack width="fill" align="center" gap={8}>
        <Footnote width="fill">{children}</Footnote>
        <Footnote>{cond(total, t("about.free", { free: size(sub(total, used)) }), "--")}</Footnote>
      </HStack>
      <Progress value={cond(total, div(mul(used, 100), total), 0)} height={8} />
    </VStack>
  );
}

/**
 * The terminal's own page, both keys together from any screen: firmware, memory, network,
 * battery.
 * Either key goes back.
 */
export function about() {
  const t = useT();
  const minutes = device("uptimeMinutes", 0);
  const percent = device("battery.percent");
  const millivolts = device("battery.millivolts");
  const usb = device("battery.usb", false);
  const supply = cond(device("battery.charging", false), concat(" · ", t("about.charging")), cond(usb, concat(" · ", t("about.plugged"))));
  const battery = cond(
    eq(percent, null),
    cond(usb, "USB", "--"),
    concat(percent, " %", cond(eq(millivolts, null), "", concat(" · ", fixed(div(millivolts, 1000), 2), " V")), supply),
  );
  return (
    <Screen theme="paper">
      <StatusBar>{t("about.title")}</StatusBar>
      <Main direction="row" gap={24}>
        <Surface variant="ink" radius={16} width={232} height="fill" align="center" justify="center" gap={6} padding={[14, 16]}>
          <OwtMark size={44} />
          <Large align="center" lines={1} fit>{t("about.terminal")}</Large>
          <Large align="center">{t("about.version", { version: device("firmware.version", "--") })}</Large>
          <Footnote align="center">{device("firmware.build", "--")}</Footnote>
          <Footnote align="center">
            {concat(
              device("firmware.commit", ""),
              cond(and(device("firmware.commit", ""), device("firmware.slot", "")), " · "),
              cond(device("firmware.slot", ""), t("about.slot", { slot: device("firmware.slot") })),
            )}
          </Footnote>
          {/* What each memory has left: the firmware's slot fills with every feature. */}
          <Separator />
          <VStack width="fill" gap={6}>
            <Gauge name="ram">{t("about.ram")}</Gauge>
            <Gauge name="psram">{t("about.psram")}</Gauge>
            <Gauge name="firmware">{t("about.firmware")}</Gauge>
            <Gauge name="storage">{t("about.storage")}</Gauge>
          </VStack>
        </Surface>
        <Facts
          dense
          height="fill"
          justify="center"
          rows={[
            [
              t("about.wifi"),
              cond(
                device("wifi.ssid", ""),
                concat(
                  device("wifi.ssid"),
                  " · ",
                  cond(eq(device("wifi.rssi"), null), t("about.offline"), concat(device("wifi.rssi"), " dBm")),
                ),
                t("about.offline"),
              ),
            ],
            [t("about.ip"), device("wifi.ip", "--")],
            [t("about.mac"), device("wifi.mac", "--")],
            [t("about.site"), device("site", "--")],
            [t("about.device"), device("device.id", "--")],
            [t("about.chip"), cond(device("chip.id", ""), concat(device("chip.model", ""), " · ", device("chip.id")), "--")],
            [t("about.battery"), battery],
            [t("about.uptime"), t("about.uptimeValue", { h: div(sub(minutes, mod(minutes, 60)), 60), m: mod(minutes, 60) })],
            // Name and this boot's passkey: what a browser nearby pairs with.
            [t("about.bluetooth"), device("bluetooth", "--")],
          ]}
        />
      </Main>
      <Keys>
        <Key side="left" primary onPress={emit("left")}>{t("about.back")}</Key>
      </Keys>
    </Screen>
  );
}
