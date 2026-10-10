/** TSX runs at build time. The output contains components, bindings and portable effects. */
import type {
  Action,
  Align,
  Binding,
  Element,
  Font,
  Node,
  Rect,
  Resource,
  SceneDefinition,
  ThemeName,
  SurfaceStyle,
  Typography,
} from "./types";
import { validApiPath, validIdentifier } from "./limits";
import { concat, eq, not, or, toBinding } from "./expr";
import { dim, layoutOf, type Dimension, type LayoutProps } from "./layout";
import { translator, type MessageTable, type Messages, type Translate } from "./i18n";
export type { Dimension, LayoutProps } from "./layout";
export type { Action, Binding, Element, Node, SceneDefinition } from "./types";

/** Offsets and sizes: sizes default to the content (`"hug"`); see runtime/layout.ts. */
type Position = { x?: number; y?: number; width?: Dimension; height?: Dimension };
export type Children = Element | Children[] | null | undefined | false;
type Props = Position & { children?: Children };
type Context = {
  resources: Resource[];
  state: Record<string, unknown>;
  actions: Record<string, Action>;
  messages: MessageTable;
};
let current: Context | null = null;
function context(): Context {
  if (!current)
    throw new Error("Device hooks can only run while compiling a screen");
  return current;
}
function node(element: Element): Node {
  if (element.kind === "screen")
    throw new Error("Screen must be the root, not a child component");
  if (element.kind === "route") throw new Error("Route must be inside Router");
  if (element.kind === "chartSeries")
    throw new Error("Line, Bar and Area must be inside a chart");
  return element;
}
function children(value?: Children): Node[] {
  if (!value) return [];
  return Array.isArray(value) ? value.flatMap(children) : [node(value)];
}
function rect({ x = 0, y = 0, width, height }: Position): Rect {
  return { x, y, width: dim(width), height: dim(height) };
}
const value = toBinding;

/** Children mixing elements and text (`<WifiIcon /> Connecté`), for labels with icons. */
export type Content = Element | string | number | boolean | null | undefined | Binding | Content[];
/** Text given as JSX children: strings, numbers and bindings, joined on the device. */
export type TextChildren = string | number | boolean | null | undefined | Binding | TextChildren[];
export function textOf(children: TextChildren): Binding {
  const parts: unknown[] = [];
  const walk = (child: TextChildren): void => {
    if (Array.isArray(child)) child.forEach(walk);
    else if (child !== null && child !== undefined && child !== false && child !== true) parts.push(child);
  };
  walk(children);
  if (parts.every((part) => typeof part !== "object")) return { literal: parts.join("") };
  return parts.length === 1 ? toBinding(parts[0]) : concat(...parts);
}
export function jsx(type: (props: never) => Element, props: unknown): Element {
  return type(props as never);
}
export const jsxs = jsx;
export function Fragment({ children: content }: { children?: Children }): Node {
  return {
    kind: "group",
    rect: { x: 0, y: 0, width: 4096, height: 4096 },
    children: children(content),
  };
}
// The custom JSX factory requires this namespace for TypeScript's component checking.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSX {
  export type Element = import("./types").Element;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
}
const OVERLAY = Symbol("overlay");
/** Mark a node as drawn over the screen, out of its flow (see `Overlay` in the kit). */
export function overlay<T extends Node>(node: T): T {
  return Object.assign(node, { [OVERLAY]: true });
}
const isOverlay = (node: Node) => OVERLAY in node;

/**
 * The app's root: the viewport (800 × 480 unless told). Its children flow as a column (pass
 * layout props to change it); overlays (`OverlayHost`, `Overlay`) sit on top, out of the flow.
 */
export function Screen(props: Props & LayoutProps & { width?: number; height?: number; theme?: ThemeName }): Element {
  const ctx = context();
  if (!Object.hasOwn(ctx.state, "theme"))
    ctx.state.theme = props.theme ?? "paper";
  const width = props.width ?? 800;
  const height = props.height ?? 480;
  const all = children(props.children);
  const { direction, gap, padding, align, justify } = props;
  const flow = Group({ width: "fill", height: "fill", direction: direction ?? "column", gap, padding, align, justify, children: all.filter((n) => !isOverlay(n)) });
  return {
    kind: "screen",
    width,
    height,
    root: Group({ width, height, children: [flow, ...all.filter(isOverlay)] }),
  };
}
/** Children placed by their x/y, or as a flex line when any layout prop is given. */
export function Group(props: Props & LayoutProps): Node {
  const layout = layoutOf(props);
  return {
    kind: "group",
    rect: rect(props),
    children: children(props.children),
    ...(layout ? { layout } : {}),
  };
}
/** A flex line: `<Stack gap={16} padding={24}>`, a column unless `direction="row"`. */
export const Stack = (props: Props & LayoutProps) => Group({ direction: "column", ...props });
export const VStack = (props: Props & Omit<LayoutProps, "direction">) => Group({ ...props, direction: "column" });
export const HStack = (props: Props & Omit<LayoutProps, "direction">) => Group({ align: "center", ...props, direction: "row" });
/** Takes the free space of its flex line (pushes siblings apart). */
export const Spacer = ({ weight = 1 }: { weight?: number }) =>
  Group({ width: { fill: weight }, height: { fill: weight } });
export function Row(props: Props & { gap?: number }): Node {
  return {
    kind: "row",
    rect: rect(props),
    gap: props.gap ?? 4,
    children: children(props.children),
  };
}
export function Column(props: Props & { gap?: number }): Node {
  return {
    kind: "column",
    rect: rect(props),
    gap: props.gap ?? 4,
    children: children(props.children),
  };
}
export function Card(props: Props & LayoutProps & SurfaceStyle & { inverted?: boolean }): Node {
  const { radius, borderWidth, borderStyle, background, opacity, shadow } = props;
  const styled = [radius, borderWidth, borderStyle, background, opacity, shadow].some(v => v !== undefined);
  const layout = layoutOf(props);
  return {
    kind: "panel",
    rect: rect(props),
    inverted: props.inverted ?? false,
    ...(styled ? { style: { radius, borderWidth, borderStyle, background, opacity, shadow } } : {}),
    ...(layout ? { layout } : {}),
    children: children(props.children),
  };
}
export function Text(
  props: Position & Typography & {
    /** The text, or give it as children: `<Text>{count} en stock</Text>`. */
    value?: unknown;
    children?: TextChildren;
    font?: Font;
    align?: Align;
    inverted?: boolean;
    maxLines?: number;
  },
): Node {
  const { fontFamily, fontSize, fontWeight, fontStyle, letterSpacing, fit } = props;
  const styled = [fontFamily, fontSize, fontWeight, fontStyle, letterSpacing, fit].some(v => v !== undefined);
  return {
    kind: "text",
    ...(styled ? { typography: { fontFamily, fontSize, fontWeight, fontStyle, ...(letterSpacing ? { letterSpacing } : {}), ...(fit ? { fit } : {}) } } : {}),
    rect: rect(props),
    value: props.value !== undefined ? value(props.value) : textOf(props.children),
    font: props.font ?? "body",
    align: props.align ?? "left",
    inverted: props.inverted ?? false,
    maxLines: props.maxLines ?? 1,
  };
}
export function Progress(props: Position & { value: unknown }): Node {
  return { kind: "progress", rect: rect(props), value: value(props.value) };
}
export function Chart(
  props: Position & {
    value: unknown;
    max: unknown;
    stroke?: "solid" | "dotted" | "dashed";
    axes?: boolean;
    /** Line width in pixels (1–4). */
    weight?: number;
    /** Dithered tone under the line, 0–100. */
    fill?: number;
  },
): Node {
  if (props.stroke || props.axes || props.weight || props.fill)
    return {
      kind: "plot",
      rect: rect(props),
      value: value(props.value),
      max: value(props.max),
      stroke: props.stroke ?? "solid",
      axes: props.axes ?? false,
      ...(props.weight ? { weight: props.weight } : {}),
      ...(props.fill ? { fill: props.fill } : {}),
    };
  return {
    kind: "chart",
    rect: rect(props),
    value: value(props.value),
    max: value(props.max),
  };
}
export function Button(
  props: Position & {
    label: unknown;
    onPress: Handler;
    input?: string;
    /** `ghost` draws nothing: put it over your own visuals to make them pressable. */
    variant?: "default" | "dock" | "ghost";
    icon?: import("../icons/factory").IconComponent;
  },
): Node {
  const action = registerAction(props.onPress);
  const icon = props.icon?.({});
  if (icon && (icon.kind !== "image" || !("literal" in icon.value)))
    throw new Error("Button icon must be a compiled icon component");
  return {
    kind: "button",
    variant: props.variant ?? "default",
    ...(icon?.kind === "image" && "literal" in icon.value
      ? {
          icon: {
            width: icon.sourceWidth,
            height: icon.sourceHeight,
            bits: icon.value.literal as number[],
          },
        }
      : {}),
    ...(props.input !== undefined ? { input: props.input } : {}),
    rect: rect(props),
    label: value(props.label),
    action,
  };
}
/** What `onPress` takes: an action, several in order, or a function returning either. */
export type Handler = Action | Action[] | (() => Action | Action[]);
function registerAction(action: Handler): string {
  const ctx = context();
  const handler = typeof action === "function" ? action() : action;
  if (Array.isArray(handler)) {
    if (handler.length === 1) return registerAction(handler[0]);
    const steps = handler.map((step) => registerAction(step));
    return registerAction({ kind: "sequence", actions: steps });
  }
  if (!handler || typeof handler !== "object" || !("kind" in handler))
    throw new Error(
      "onPress callbacks must return a device action; use () => buzzer.beep(...)",
    );
  const id = `action${Object.keys(ctx.actions).length}`;
  ctx.actions[id] = handler;
  return id;
}
export function useToast() {
  context();
  return {
    show: (message: string, options: { durationMs?: number } = {}): Action => ({
      kind: "toast",
      message,
      durationMs: options.durationMs ?? 5000,
    }),
  };
}
export function useDialog() {
  context();
  return {
    confirm: (options: {
      title: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      onConfirm: Handler;
    }): Action => ({
      kind: "dialog",
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? "Confirmer",
      cancelLabel: options.cancelLabel ?? "Annuler",
      onConfirm: registerAction(options.onConfirm),
    }),
  };
}
export function List(
  props: Position & { value: unknown; gap?: number; children: Element },
): Node {
  return {
    kind: "repeat",
    rect: rect(props),
    value: value(props.value),
    child: node(props.children),
    gap: props.gap ?? 4,
  };
}
export function Image(
  props: Position & {
    value?: unknown;
    src?: string | Binding;
    fit?: "contain" | "cover";
    sourceWidth?: number;
    sourceHeight?: number;
    /** Draw the ink in paper colour, over an ink surface. */
    inverted?: boolean;
  },
): Node {
  if (props.src !== undefined) {
    if (props.value !== undefined)
      throw new Error("Image accepts src or value, not both");
    return {
      kind: "webImage",
      rect: rect(props),
      src: value(props.src),
      fit: props.fit ?? "contain",
    };
  }
  if (props.value === undefined)
    throw new Error("Image needs a src URL or packed value");
  return {
    kind: "image",
    rect: rect(props),
    value: value(props.value),
    sourceWidth: props.sourceWidth ?? 24,
    sourceHeight: props.sourceHeight ?? 24,
    ...(props.inverted ? { inverted: true } : {}),
  };
}
/**
 * A QR code on a paper quiet zone. `dots` and `rounded` restyle the modules and round the
 * finder patterns; a `logo` sits in a cleared centre and forces high error correction.
 */
export function Qr(
  props: Position & {
    value: unknown;
    style?: "square" | "dots" | "rounded";
    ecc?: "low" | "medium" | "quartile" | "high";
    quiet?: number;
    logo?: import("../icons/factory").IconComponent;
  },
): Node {
  const logo = props.logo?.({});
  if (logo && (logo.kind !== "image" || !("literal" in logo.value)))
    throw new Error("QR logo must be a compiled icon component");
  return {
    kind: "qr",
    rect: rect(props),
    value: value(props.value),
    ...(props.style ? { style: props.style } : {}),
    ...(props.ecc ? { ecc: props.ecc } : {}),
    ...(props.quiet !== undefined ? { quiet: props.quiet } : {}),
    ...(logo?.kind === "image" && "literal" in logo.value
      ? { logo: { width: logo.sourceWidth, height: logo.sourceHeight, bits: logo.value.literal as number[] } }
      : {}),
  };
}
/** Shows its child when `value` is truthy. Unsized, it takes its child's size (transparent). */
export function When(
  props: Position & { value: unknown; children: Element },
): Node {
  const child = node(props.children);
  return {
    kind: "when",
    rect: {
      ...rect(props),
      ...(props.width === undefined ? { width: child.rect.width } : {}),
      ...(props.height === undefined ? { height: child.rect.height } : {}),
    },
    value: value(props.value),
    child,
  };
}
/** One node from children: itself if alone, else a column of them. */
function single(content: Children): Node {
  const nodes = children(content);
  return nodes.length === 1 ? nodes[0] : Group({ direction: "column", children: nodes });
}
/**
 * Conditional rendering, decided on the device: `{cond && <X/>}` in React. Hidden content takes
 * no room in a flex line. `fallback` shows otherwise.
 *
 *   <Show when={gt(stock, 0)} fallback={<Muted>Épuisé</Muted>}><Num>{stock}</Num></Show>
 */
export function Show(props: { when: unknown; fallback?: Children; children?: Children }): Node {
  const shown = When({ value: props.when, children: single(props.children) });
  if (props.fallback === undefined) return shown;
  return Group({ children: [shown, When({ value: not(props.when), children: single(props.fallback) })] });
}
const CASE = Symbol("case");
type CaseNode = Node & { [CASE]: { is?: unknown; default: boolean } };
/** A branch of `Switch`, shown when the value equals `is`. */
export function Case(props: { is: unknown; children?: Children }): Node {
  return Object.assign(single(props.children), { [CASE]: { is: props.is, default: false } });
}
/** The branch of `Switch` shown when no `Case` matches. */
export function Default(props: { children?: Children }): Node {
  return Object.assign(single(props.children), { [CASE]: { default: true } });
}
/** One of several branches by value: `<Switch value={x}><Case is="a">…</Case><Default>…</Default></Switch>`. */
export function Switch(props: { value: unknown; children?: Children }): Node {
  const branches = children(props.children) as CaseNode[];
  if (branches.some((b) => !(CASE in b))) throw new Error("Switch takes Case and Default children");
  const cases = branches.filter((b) => !b[CASE].default);
  return Group({
    children: branches.map((branch) =>
      When({
        value: branch[CASE].default
          ? not(or(false, ...cases.map((c) => eq(props.value, c[CASE].is))))
          : eq(props.value, branch[CASE].is),
        children: branch,
      }),
    ),
  });
}
export function Modal(
  props: Position & { value: unknown; children: Element },
): Node {
  return {
    kind: "modal",
    rect: rect(props),
    value: value(props.value),
    child: node(props.children),
  };
}
export function bind(path: string, fallback: unknown = null): Binding {
  return { bind: path, fallback };
}
export function item(path: string): Binding {
  return bind(`item.${path}`);
}
export function useDeviceData(
  id: string,
  path: string,
  options: { refreshMs?: number; onWake?: boolean } = {},
): (field: string, fallback?: unknown) => Binding {
  const ctx = context();
  if (
    !validIdentifier(id) ||
    id === "local" ||
    ctx.resources.some((resource) => resource.id === id) ||
    !validApiPath(path)
  ) {
    throw new Error(
      "Resources need unique identifiers and same-origin API paths",
    );
  }
  ctx.resources.push({
    id,
    path,
    refreshMs: options.refreshMs ?? 0,
    onWake: options.onWake ?? true,
  });
  return (field, fallback = null) =>
    bind(field ? `${id}.${field}` : id, fallback);
}
export function useDeviceState(
  key: string,
  initial: unknown,
): [Binding, (value: unknown) => Action] {
  const ctx = context();
  if (!validIdentifier(key)) throw new Error(`Invalid state key: ${key}`);
  if (Object.hasOwn(ctx.state, key)) throw new Error(`Duplicate state: ${key}`);
  ctx.state[key] = initial;
  return [
    bind(`local.${key}`, initial),
    // A binding or an expression is evaluated when the action runs: `setCount(add(count, 1))`.
    (next) =>
      next && typeof next === "object" && ("bind" in next || "expr" in next)
        ? { kind: "setStateBound", key, value: next as Binding }
        : { kind: "setState", key, value: next },
  ];
}
export function compileScreen(component: () => Element): SceneDefinition {
  if (current) throw new Error("Nested compilation is not supported");
  current = {
    resources: [],
    state: Object.create(null),
    actions: Object.create(null),
    messages: { locales: [], table: Object.create(null) },
  };
  try {
    const screen = component();
    if (screen.kind !== "screen") throw new Error("Root must be a Screen");
    return {
      version: 1,
      width: screen.width,
      height: screen.height,
      resources: current.resources,
      state: current.state,
      actions: current.actions,
      ...(current.messages.locales.length ? { messages: current.messages } : {}),
      root: screen.root,
    };
  } finally {
    current = null;
  }
}

/**
 * Translations for this app: `const t = useI18n(messages)`, then `<Text>{t("stock", { count })}</Text>`.
 * The text is chosen on the device, from the `locale` state, the host's locale or the default.
 */
export function useI18n<M extends Messages>(messages: M): Translate<M> {
  return translator(messages, context().messages);
}
/** The locale the app shows (empty: the host's) and its setter, for a language switch. */
export function useLocale(): [Binding, (locale: string) => Action] {
  const [locale, setLocale] = useDeviceState("locale", "");
  return [locale, (next) => setLocale(next)];
}

/** Theme setters compile to portable local-state actions, just like other device hooks. */
export function useDeviceTheme(
  initial: ThemeName = "paper",
): [Binding, (theme: ThemeName) => Action] {
  const [theme, setTheme] = useDeviceState("theme", initial);
  return [theme, setTheme];
}

/** Compile a hardware effect; the host plays it each time the action is dispatched. */
export function useBuzzer(): {
  beep: (tone?: "key" | "success" | "error" | "notification" | "badge") => Action;
} {
  context();
  return { beep: (tone = "key") => ({ kind: "beep", tone }) };
}

/** Read-only host metadata and telemetry. Actual fields come from the device's board adapter. */
export function useDeviceInfo(): (
  field: string,
  fallback?: unknown,
) => Binding {
  context();
  return (field, fallback = null) => bind(`$device.${field}`, fallback);
}
