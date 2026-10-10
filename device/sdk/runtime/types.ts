/** The build-time model consumed by the binary compiler, never shipped as JSON. */
export type Binding =
  | { bind: string; fallback?: unknown }
  | { literal: unknown }
  /** Computed on the device; build with the helpers of runtime/expr.ts. */
  | { expr: import("./expr").Op; args: Binding[] };
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
  /** Local state set to an expression evaluated when the action runs. */
  | { kind: "setStateBound"; key: string; value: Binding }
  /** Several actions in order (registered ids). */
  | { kind: "sequence"; actions: string[] }
  | { kind: "fetch"; resource: string }
  | { kind: "emit"; name: string }
  | {
      kind: "navigate";
      operation: "push" | "replace" | "back" | "reset";
      route?: string;
    }
  | { kind: "beep"; tone: "key" | "success" | "error" | "notification" | "badge" };
/** Width and height are pixels or size codes (see runtime/layout.ts: hug, fill, percent). */
export type Rect = { x: number; y: number; width: number; height: number };
/** A flex line, as encoded (runtime/layout.ts builds it from props). */
export type Layout = {
  direction: "row" | "column";
  align: "start" | "center" | "end" | "stretch";
  justify: "start" | "center" | "end" | "between" | "around" | "evenly";
  gap: number;
  padding: [number, number, number, number];
};
export type ThemeName = "flipper" | "macos" | "paper" | "dark";
export type Font = "caption" | "body" | "title" | "display";
export type Align = "left" | "center" | "right";
/** Sizes per family. `grotesk` 49 and `numeric` 62, 78, 92 have figures only. */
export type ClassicSize = 8 | 10 | 12 | 14 | 18 | 24;
export type GroteskSize = 11 | 14 | 17 | 20 | 25 | 30 | 35 | 42 | 49;
export type NumericSize = 20 | 24 | 28 | 32 | 38 | 46 | 58 | 62 | 78 | 92;
export type Typography = {
  /** `grotesk`: Free Universal, a Univers-like grotesque. `numeric`: Logisoso condensed figures. */
  fontFamily?: "pixel" | "sans" | "mono" | "grotesk" | "numeric";
  fontSize?: ClassicSize | GroteskSize | NumericSize;
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
  /** Extra pixels between glyphs (0–16), for spaced capitals. */
  letterSpacing?: number;
  /** Too long for its box: the family's smaller sizes before an ellipsis. */
  fit?: boolean;
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
    | { kind: "group"; children: Node[]; layout?: Layout }
    | { kind: "row" | "column"; gap: number; children: Node[] }
    | { kind: "panel"; inverted: boolean; style?: SurfaceStyle; children: Node[]; layout?: Layout }
    | {
        kind: "text";
        value: Binding;
        font: Font;
        align: Align;
        inverted: boolean;
        maxLines: number;
        typography?: Typography;
      }
    | { kind: "progress"; value: Binding }
    | {
        kind: "qr";
        value: Binding;
        style?: "square" | "dots" | "rounded";
        ecc?: "low" | "medium" | "quartile" | "high";
        quiet?: number;
        logo?: { width: number; height: number; bits: number[] };
      }
    | { kind: "chart"; value: Binding; max: Binding }
    | {
        kind: "plot";
        value: Binding;
        max: Binding;
        stroke: "solid" | "dotted" | "dashed";
        axes: boolean;
        /** Line width in pixels (1–4). */
        weight?: number;
        /** Dithered tone under the line (0–100). */
        fill?: number;
      }
    | {
        kind: "button";
        label: Binding;
        action: string;
        input?: string;
        /** `ghost`: hit area and hardware input only, drawn by the app. */
        variant?: "default" | "dock" | "ghost";
        icon?: { width: number; height: number; bits: number[] };
      }
    | {
        kind: "image";
        value: Binding;
        sourceWidth: number;
        sourceHeight: number;
        /** Paper-coloured ink, for icons on ink surfaces. */
        inverted?: boolean;
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
        /** Bars pile up per category, darkest at the bottom. */
        stacked?: boolean;
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
  /** Translations: locales (default first) and, per key, one message per locale. */
  messages?: { locales: string[]; table: Record<string, string[]> };
  root: Node;
};
/** Packed monochrome sprite, row-contiguous, MSB first; 1 means ink. */
export type SpriteAsset = { width: number; height: number; bits: number[] };
