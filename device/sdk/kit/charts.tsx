/** Recharts-inspired composition, compiled entirely into device bytecode. */
import type {
  Binding,
  ChartSeries,
  Element,
  Node,
  SeriesElement,
} from "../runtime/types";
import { dim, type Dimension } from "../runtime/layout";
import { Chart } from "../runtime/jsx-runtime";

type SeriesProps = {
  dataKey: string;
  name?: string;
  stroke?: ChartSeries["stroke"];
};
function series(
  style: ChartSeries["style"],
  props: SeriesProps,
): SeriesElement {
  return {
    kind: "chartSeries",
    style,
    dataKey: props.dataKey,
    label: props.name ?? props.dataKey,
    stroke: props.stroke ?? "solid",
  };
}
export const Line = (props: SeriesProps): SeriesElement =>
  series("line", props);
export const Bar = (props: SeriesProps): SeriesElement => series("bar", props);
export const Area = (props: SeriesProps): SeriesElement =>
  series("area", props);

type ChartChildren = Element | ChartChildren[] | null | undefined | false;
export type ChartProps = {
  x?: number;
  y?: number;
  /** Fills its parent by default. */
  width?: Dimension;
  height?: Dimension;
  data: Binding | Record<string, unknown>[];
  /** A positive fixed domain, or omit for a shared automatic domain across every series. */
  max?: Binding | number;
  xKey?: string;
  axes?: boolean;
  grid?: boolean;
  legend?: boolean;
  /** Bar series pile up in one column per category: solid, 50 %, 25 %, 12 % from the bottom. */
  stacked?: boolean;
  children: ChartChildren;
};
function binding(value: unknown): Binding {
  return value &&
    typeof value === "object" &&
    ("bind" in value || "literal" in value)
    ? (value as Binding)
    : { literal: value };
}
export function ComposedChart(props: ChartProps): Node {
  function collect(children: ChartChildren): ChartSeries[] {
    if (!children) return [];
    if (Array.isArray(children)) return children.flatMap(collect);
    if (children.kind !== "chartSeries")
      throw new Error("Charts accept Line, Bar and Area children");
    const { dataKey, label, style, stroke } = children;
    return [{ dataKey, label, style, stroke }];
  }
  return {
    kind: "cartesianChart",
    rect: {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: dim(props.width, "fill"),
      height: dim(props.height, "fill"),
    },
    data: binding(props.data),
    max: binding(props.max ?? 0),
    series: collect(props.children),
    xKey: props.xKey ?? "",
    axes: props.axes ?? true,
    grid: props.grid ?? true,
    legend: props.legend ?? true,
    ...(props.stacked ? { stacked: true } : {}),
  };
}
export const LineChart = ComposedChart;
export const BarChart = ComposedChart;
export const AreaChart = ComposedChart;

/** A sparkline: a 2 px line over a light dither, full width, no axes. */
export function Spark({
  value,
  max,
  height = 80,
  width = "fill",
  stroke = "solid",
  fill = 12,
}: {
  value: unknown;
  max: unknown;
  height?: Dimension;
  width?: Dimension;
  stroke?: "solid" | "dotted" | "dashed";
  fill?: number;
}): Node {
  return Chart({ value, max, width, height, stroke, weight: 2, fill });
}
