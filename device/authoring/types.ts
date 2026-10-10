/** The build-time model consumed by the binary compiler, never shipped as JSON. */
export type Binding =
  { bind: string; fallback?: unknown } | { literal: unknown };
export type Action =
  | { kind: "toast"; message: string; durationMs: number }
  | {
      kind: "dialog";
      title: string;
      message: string;
      confirmLabel: string;
      cancelLabel: string;
      onConfirm: string;
    }
  | { kind: "dialogChoice"; confirm: boolean }
  | { kind: "setState"; key: string; value: unknown }
  | { kind: "fetch"; resource: string }
  | { kind: "emit"; name: string }
  | {
      kind: "navigate";
      operation: "push" | "replace" | "back" | "reset";
      route?: string;
    }
  | { kind: "beep"; tone: "key" | "success" | "error" | "notification" };
export type Rect = { x: number; y: number; width: number; height: number };
export type ThemeName = "flipper" | "macos" | "dark";
export type Font = "caption" | "body" | "title" | "display";
export type Align = "left" | "center" | "right";
export type Typography = {
  fontFamily?: "pixel" | "sans" | "mono";
  fontSize?: 8 | 10 | 12 | 14 | 18 | 24;
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
};
export type SurfaceStyle = {
  radius?: number;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed" | "dotted";
  background?: "paper" | "ink" | "transparent";
  opacity?: number;
  shadow?: { x: number; y: number; opacity?: number };
};
type Cell = { rect: Rect };
export type Node = Cell &
  (
    | {
        kind: "router";
        initial: string;
        routes: { name: string; root: Node }[];
      }
    | { kind: "group"; children: Node[] }
    | { kind: "row" | "column"; gap: number; children: Node[] }
    | { kind: "panel"; inverted: boolean; style?: SurfaceStyle; children: Node[] }
    | {
        kind: "text";
        value: Binding;
        font: Font;
        align: Align;
        inverted: boolean;
        maxLines: number;
        typography?: Typography;
      }
    | { kind: "progress" | "qr"; value: Binding }
    | { kind: "chart"; value: Binding; max: Binding }
    | {
        kind: "plot";
        value: Binding;
        max: Binding;
        stroke: "solid" | "dotted" | "dashed";
        axes: boolean;
      }
    | {
        kind: "button";
        label: Binding;
        action: string;
        input?: string;
        variant?: "default" | "dock";
        icon?: { width: number; height: number; bits: number[] };
      }
    | {
        kind: "image";
        value: Binding;
        sourceWidth: number;
        sourceHeight: number;
      }
    | {
        kind: "cartesianChart";
        data: Binding;
        max: Binding;
        series: ChartSeries[];
        xKey: string;
        axes: boolean;
        grid: boolean;
        legend: boolean;
      }
    | { kind: "webImage"; src: Binding; fit: "contain" | "cover" }
    | { kind: "repeat"; value: Binding; gap: number; child: Node }
    | { kind: "when" | "modal"; value: Binding; child: Node }
  );
export type ScreenElement = {
  kind: "screen";
  width: number;
  height: number;
  root: Node;
};
export type ChartSeries = {
  dataKey: string;
  label: string;
  style: "line" | "bar" | "area";
  stroke: "solid" | "dotted" | "dashed";
};
export type SeriesElement = ChartSeries & { kind: "chartSeries" };
export type RouteElement = { kind: "route"; name: string; root: Node };
export type Element = Node | ScreenElement | SeriesElement | RouteElement;
export type Resource = {
  id: string;
  path: string;
  refreshMs: number;
  onWake: boolean;
};
export type SceneDefinition = {
  version: 1;
  width: number;
  height: number;
  resources: Resource[];
  state: Record<string, unknown>;
  actions: Record<string, Action>;
  root: Node;
};
