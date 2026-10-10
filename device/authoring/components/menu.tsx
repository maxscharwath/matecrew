/** @jsxImportSource .. */
import { Group, Button, Text } from "../jsx-runtime";
import type { Action } from "../types";
import type { IconComponent } from "../icons/factory";

/** A menu row with stable icon and text columns; icons retain their native pixels. */
export function MenuItem({
  x = 0,
  y = 0,
  width = 164,
  height = 26,
  label,
  icon: Icon,
  onPress,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label: unknown;
  icon: IconComponent;
  onPress: Action;
}) {
  const glyph = Icon({});
  if (
    !("rect" in glyph) ||
    glyph.rect.height > height - 4 ||
    glyph.rect.width > 24
  )
    throw new Error(
      "MenuItem needs a native icon at most 24px wide that fits its height",
    );
  return (
    <Group x={x} y={y} width={width} height={height}>
      <Button width={width} height={height} label="" onPress={onPress} />
      <Icon
        x={10 + Math.floor((24 - glyph.rect.width) / 2)}
        y={Math.floor((height - glyph.rect.height) / 2)}
      />
      <Text
        x={42}
        y={Math.floor((height - 12) / 2)}
        width={width - 52}
        height={16}
        value={label}
      />
    </Group>
  );
}
