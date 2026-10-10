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
export type { Action, Binding, Element, Node, SceneDefinition } from "./types";

type Position = Omit<Rect, "x" | "y"> & { x?: number; y?: number };
export type Children = Element | Children[] | null | undefined | false;
type Props = Position & { children?: Children };
type Context = {
  resources: Resource[];
  state: Record<string, unknown>;
  actions: Record<string, Action>;
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
  return { x, y, width, height };
}
function value(input: unknown): Binding {
  if (
    input &&
    typeof input === "object" &&
    ("bind" in input || "literal" in input)
  )
    return input as Binding;
  return { literal: input };
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
export function Screen(props: Props & { theme?: ThemeName }): Element {
  const ctx = context();
  if (!Object.hasOwn(ctx.state, "theme"))
    ctx.state.theme = props.theme ?? "flipper";
  return {
    kind: "screen",
    width: props.width,
    height: props.height,
    root: Group(props),
  };
}
export function Group(props: Props): Node {
  return {
    kind: "group",
    rect: rect(props),
    children: children(props.children),
  };
}
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
export function Card(props: Props & SurfaceStyle & { inverted?: boolean }): Node {
  const { radius, borderWidth, borderStyle, background, opacity, shadow } = props;
  const styled = [radius, borderWidth, borderStyle, background, opacity, shadow].some(v => v !== undefined);
  return {
    kind: "panel",
    rect: rect(props),
    inverted: props.inverted ?? false,
    ...(styled ? { style: { radius, borderWidth, borderStyle, background, opacity, shadow } } : {}),
    children: children(props.children),
  };
}
export function Text(
  props: Position & Typography & {
    value: unknown;
    font?: Font;
    align?: Align;
    inverted?: boolean;
    maxLines?: number;
  },
): Node {
  const { fontFamily, fontSize, fontWeight, fontStyle } = props;
  const styled = [fontFamily, fontSize, fontWeight, fontStyle].some(v => v !== undefined);
  return {
    kind: "text",
    ...(styled ? { typography: { fontFamily, fontSize, fontWeight, fontStyle } } : {}),
    rect: rect(props),
    value: value(props.value),
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
  },
): Node {
  if (props.stroke || props.axes)
    return {
      kind: "plot",
      rect: rect(props),
      value: value(props.value),
      max: value(props.max),
      stroke: props.stroke ?? "solid",
      axes: props.axes ?? false,
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
    onPress: Action | (() => Action);
    input?: string;
    variant?: "default" | "dock";
    icon?: import("./icons/factory").IconComponent;
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
function registerAction(action: Action | (() => Action)): string {
  const ctx = context();
  const handler = typeof action === "function" ? action() : action;
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
      onConfirm: Action | (() => Action);
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
  };
}
export function Qr(props: Position & { value: unknown }): Node {
  return { kind: "qr", rect: rect(props), value: value(props.value) };
}
export function When(
  props: Position & { value: unknown; children: Element },
): Node {
  return {
    kind: "when",
    rect: rect(props),
    value: value(props.value),
    child: node(props.children),
  };
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
    (next) => ({ kind: "setState", key, value: next }),
  ];
}
export function compileScreen(component: () => Element): SceneDefinition {
  if (current) throw new Error("Nested compilation is not supported");
  current = {
    resources: [],
    state: Object.create(null),
    actions: Object.create(null),
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
      root: screen.root,
    };
  } finally {
    current = null;
  }
}

/** Theme setters compile to portable local-state actions, just like other device hooks. */
export function useDeviceTheme(
  initial: ThemeName = "flipper",
): [Binding, (theme: ThemeName) => Action] {
  const [theme, setTheme] = useDeviceState("theme", initial);
  return [theme, setTheme];
}

/** Compile a hardware effect; the host plays it each time the action is dispatched. */
export function useBuzzer(): {
  beep: (tone?: "key" | "success" | "error" | "notification") => Action;
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
