/** @jsxImportSource .. */
import { Card, Image, Text, When, type Element } from "../jsx-runtime";

type MetricProps = {
  x?: number;
  y?: number;
  width?: number;
  label: unknown;
  value: unknown;
  warning?: unknown;
  caption?: unknown;
};

/** A stock card with a native 24px product asset and a stable numeric baseline. */
export function MetricHero({
  label,
  value,
  image,
  warning = false,
  caption = "",
  x = 0,
  y = 0,
  width = 176,
}: MetricProps & { image: unknown }): Element {
  return (
    <Card x={x} y={y} width={width} height={96}>
      <Text
        x={12}
        y={10}
        width={width - 24}
        height={34}
        maxLines={2}
        font="body"
        value={label}
      />
      <Text
        x={12}
        y={47}
        width={width - 52}
        height={30}
        font="display"
        value={value}
      />
      <Image x={width - 36} y={52} width={24} height={24} value={image} />
      <Text
        x={12}
        y={79}
        width={width - 24}
        height={14}
        font="caption"
        value={caption}
      />
      <When x={8} y={77} width={width - 16} height={16} value={warning}>
        <Card width={width - 16} height={16} inverted>
          <Text
            x={4}
            y={1}
            width={width - 24}
            height={14}
            font="caption"
            inverted
            value="Stock bas"
          />
        </Card>
      </When>
    </Card>
  );
}

/** Compact horizontal metric for preference lists and secondary summaries. */
export function MetricCompact({
  x = 0,
  y = 0,
  width = 176,
  label,
  value,
  warning = false,
  caption = "",
}: MetricProps): Element {
  return (
    <Card x={x} y={y} width={width} height={48}>
      <Text
        x={12}
        y={7}
        width={width - 24}
        height={16}
        font="caption"
        value={label}
      />
      <Text x={12} y={27} width={52} height={18} font="title" value={value} />
      <Text
        x={66}
        y={28}
        width={width - 78}
        height={16}
        font="caption"
        value={caption}
      />
      <When x={64} y={26} width={width - 72} height={18} value={warning}>
        <Card width={width - 72} height={18} inverted>
          <Text
            x={4}
            y={2}
            width={width - 80}
            height={14}
            font="caption"
            inverted
            value="Stock bas"
          />
        </Card>
      </When>
    </Card>
  );
}
