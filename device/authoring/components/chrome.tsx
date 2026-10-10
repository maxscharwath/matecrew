/** @jsxImportSource .. */
import {
  Button,
  Card,
  Group,
  Image,
  Text,
  bind,
  type Element,
} from "../jsx-runtime";
import type { Action } from "../types";
import type { IconComponent } from "../icons/factory";
import { CreditCardIcon } from "../icons/system";

/**
 * System strip: one app title, then a separate, right-aligned status cluster.
 * The host supplies dedicated 12px status sprites, generated at build time.
 * Never squeeze the full-size catalogue glyphs into this compact status row.
 * `icon` remains accepted for app metadata; decorative app icons do not belong in
 * this compact strip, where they compete with the title and connection status.
 */
export function DeviceChrome({
  title,
  status = bind("$device.clock", "--:--"),
}: {
  title: unknown;
  status?: unknown;
  icon?: IconComponent;
}): Element {
  const titleWidth =
    typeof title === "string" ? Math.min(228, title.length * 6 + 16) : 120;
  return (
    <Group width={400} height={22}>
      <Card x={8} y={2} width={titleWidth} height={18} inverted />
      <Text
        x={16}
        y={5}
        width={titleWidth - 16}
        height={14}
        value={title}
        font="caption"
        maxLines={1}
        inverted
      />
      <Text
        x={268}
        y={5}
        width={42}
        height={14}
        value={status}
        font="caption"
        align="right"
      />
      <Image
        x={320}
        y={5}
        width={12}
        height={12}
        sourceWidth={12}
        sourceHeight={12}
        value={bind("$device.status.wifi", [])}
      />
      <Image
        x={346}
        y={5}
        width={12}
        height={12}
        sourceWidth={12}
        sourceHeight={12}
        value={bind("$device.status.battery", [])}
      />
      <Text
        x={362}
        y={5}
        width={26}
        height={14}
        value={bind("$device.status.batteryText", "—")}
        font="caption"
        align="right"
      />
      <Card y={21} width={400} height={1} inverted />
    </Group>
  );
}
export function DeviceFooter({ value }: { value: unknown }): Element {
  return (
    <Text
      x={8}
      y={216}
      width={384}
      height={18}
      font="caption"
      align="center"
      value={value}
    />
  );
}
/** Physical affordances: anchored key caps, downward arrows, central contactless reader. */
export function KeyBar({
  left,
  right,
  onLeft,
  onRight,
}: {
  left: unknown;
  right: unknown;
  onLeft: Action;
  onRight: Action;
}): Element {
  return (
    <Group y={214} width={400} height={26}>
      <Button
        input="left"
        variant="dock"
        width={140}
        height={26}
        label={left}
        onPress={onLeft}
      />
      <CreditCardIcon x={178} y={7} size={12} />
      <Text
        x={198}
        y={7}
        width={28}
        height={16}
        font="caption"
        align="left"
        value="RFID"
      />
      <Button
        input="right"
        variant="dock"
        x={260}
        width={140}
        height={26}
        label={right}
        onPress={onRight}
      />
    </Group>
  );
}
