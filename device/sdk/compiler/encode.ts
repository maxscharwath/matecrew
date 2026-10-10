/** DUI1 encoder. Geometry and node kinds are opcodes; only values and bindings use strings. */
import { Writer, integer } from "./writer";
import type {
  Action,
  Binding,
  Layout,
  Node,
  SceneDefinition,
  SurfaceStyle,
  Typography,
} from "../runtime/types";
import {
  LIMITS,
  validApiPath,
  validIdentifier,
  validImageSource,
} from "../runtime/limits";
import { OPS, MAX_ARGS } from "../runtime/expr";
import { validDim } from "../runtime/layout";

/** Bitmap sizes each family has (see engine/src/scene/typography.rs). */
const CLASSIC_SIZES = [8, 10, 12, 14, 18, 24];
const GROTESK_SIZES = [11, 14, 17, 20, 25, 30, 35, 42, 49];
const NUMERIC_SIZES = [20, 24, 28, 32, 38, 46, 58, 62, 78, 92];
/** By family index; the others use the classic ladder. */
const FAMILY_SIZES: Record<number, number[]> = { 4: GROTESK_SIZES, 5: NUMERIC_SIZES };

/** Opcodes 1 and 2 (the removed fixed-step stacks) are retired, not reused. */
const NODE_CODES = {
  group: 0,
  panel: 3,
  text: 4,
  progress: 5,
  chart: 6,
  button: 7,
  repeat: 8,
  image: 9,
  qr: 10,
  when: 11,
  plot: 12,
  webImage: 13,
  cartesianChart: 14,
  router: 16,
  modal: 19,
} as const;
const FONTS = ["caption", "body", "title", "display"] as const;
const ALIGNS = ["left", "center", "right"] as const;
const FAMILIES = [undefined, "pixel", "sans", "mono", "grotesk", "numeric"];
const WEIGHTS = [undefined, "normal", "bold"];
const FONT_STYLES = new Set([undefined, "normal", "italic"]);
const STROKES = ["solid", "dotted", "dashed"];
const BUTTON_VARIANTS = new Set(["default", "dock", "ghost"]);
const NAVIGATIONS = ["push", "replace", "back", "reset"];
const TONES = ["key", "success", "error", "notification", "badge"];
const utf8 = new TextEncoder();

type NodeOf<K extends Node["kind"]> = Extract<Node, { kind: K }>;
type ActionOf<K extends Action["kind"]> = Extract<Action, { kind: K }>;
type SpriteData = { width: number; height: number; bits: number[] };

const bit = (on: unknown): number => (on ? 1 : 0);
const isByte = (b: unknown): boolean => Number.isInteger(b) && (b as number) >= 0 && (b as number) <= 255;
/** Short text a dialog or toast shows: 1 to 256 UTF-8 bytes. */
const validText = (text: string | undefined): boolean => Boolean(text) && utf8.encode(text).length <= 256;
/** Byte (code unit) order, as the engine looks keys up. */
const byCodeUnit = (a: string, b: string): number => Number(a > b) - Number(a < b);

export function encodeScene(scene: SceneDefinition): Uint8Array<ArrayBuffer> {
  if (scene.version !== 1) throw new Error("Unsupported scene version");
  integer(scene.width, 1, LIMITS.viewport, "viewport width");
  integer(scene.height, 1, LIMITS.viewport, "viewport height");
  return new SceneEncoder(scene).encode();
}

/** A literal image whose value is exactly its packed rows: compiled icons and art. */
function packedSprite(input: NodeOf<"image">): boolean {
  if (!("literal" in input.value) || !Array.isArray(input.value.literal)) return false;
  const bits = input.value.literal as unknown[];
  return bits.length === Math.ceil((input.sourceWidth * input.sourceHeight) / 8) && bits.every(isByte);
}

function hasQrOptions(input: NodeOf<"qr">): boolean {
  return Boolean(input.style || input.ecc || input.quiet !== undefined || input.logo);
}

function textOpcode(input: NodeOf<"text">): number {
  if (input.typography?.letterSpacing) return 22;
  return input.typography ? 21 : NODE_CODES.text;
}

function buttonOpcode(input: NodeOf<"button">): number {
  if (input.variant === "ghost") return 23;
  if (input.icon) return 18;
  if (input.variant === "dock") return 17;
  return input.input === undefined ? NODE_CODES.button : 15;
}

function imageOpcode(input: NodeOf<"image">): number {
  if (packedSprite(input)) return 27;
  return input.inverted ? 26 : NODE_CODES.image;
}

function panelOpcode(input: NodeOf<"panel">): number {
  if (input.layout) return 29;
  return input.style ? 20 : NODE_CODES.panel;
}

/** The node's opcode: its kind's code, or the code of the variant its options call for. */
function opcode(input: Node): number {
  switch (input.kind) {
    case "text":
      return textOpcode(input);
    case "qr":
      return hasQrOptions(input) ? 24 : NODE_CODES.qr;
    case "button":
      return buttonOpcode(input);
    case "plot":
      return input.weight || input.fill ? 25 : NODE_CODES.plot;
    case "image":
      return imageOpcode(input);
    case "group":
      return input.layout ? 28 : NODE_CODES.group;
    case "panel":
      return panelOpcode(input);
    default:
      return NODE_CODES[input.kind];
  }
}

function checkSprite(input: SpriteData, max: number, label: string): void {
  const { width, height, bits } = input;
  integer(width, 1, max, `${label} width`);
  integer(height, 1, max, `${label} height`);
  if (bits.length !== Math.ceil((width * height) / 8) || !bits.every(isByte))
    throw new Error(`Invalid ${label} pixels`);
}

function checkResource(resource: SceneDefinition["resources"][number], ids: Set<string>): void {
  if (
    !validIdentifier(resource.id) ||
    resource.id === "local" ||
    ids.has(resource.id) ||
    !validApiPath(resource.path)
  )
    throw new Error("Invalid or duplicate resource");
}

function checkState(state: SceneDefinition["state"]): void {
  if (
    !state ||
    Array.isArray(state) ||
    typeof state !== "object" ||
    Object.keys(state).some((key) => !validIdentifier(key))
  )
    throw new Error("Invalid local state");
}

/** One scene's payload, with its string table built in first-use order. */
class SceneEncoder {
  private readonly payload = new Writer();
  private readonly strings = new Map<string, number>();
  private readonly routeNames = new Set<string>();
  private readonly resourceIds = new Set<string>();
  private values = 0;
  private nodes = 0;
  private routers = 0;

  constructor(private readonly scene: SceneDefinition) {}

  encode(): Uint8Array<ArrayBuffer> {
    const { scene } = this;
    this.resources();
    checkState(scene.state);
    this.value(scene.state);
    if (utf8.encode(JSON.stringify(scene.state)).length > LIMITS.localState)
      throw new Error("Local state exceeds device size limit");
    this.actions();
    this.messages();
    this.node(scene.root);
    this.checkNavigation();
    const out = new Writer();
    out.append([68, 85, 73, 49]); // DUI1
    out.u16(scene.width);
    out.u16(scene.height);
    out.u16(this.strings.size);
    for (const input of this.strings.keys()) {
      const encoded = utf8.encode(input);
      out.u16(encoded.length);
      out.append(encoded);
    }
    out.append(this.payload.bytes);
    return Uint8Array.from(out.bytes);
  }

  private string(input: string): void {
    if (typeof input !== "string") throw new Error("Expected string");
    let index = this.strings.get(input);
    if (index === undefined) {
      if (this.strings.size >= LIMITS.strings)
        throw new Error("String limit exceeded");
      index = this.strings.size;
      this.strings.set(input, index);
    }
    this.payload.u16(index);
  }

  private value(input: unknown, depth = 0): void {
    if (++this.values > LIMITS.values || depth > LIMITS.depth)
      throw new Error(
        "Literal limit exceeded: value is too large, deep or cyclic",
      );
    if (input == null) this.payload.u8(0);
    else if (typeof input === "boolean") this.payload.u8(input ? 2 : 1);
    else if (typeof input === "number") this.number(input);
    else if (typeof input === "string") {
      this.payload.u8(5);
      this.string(input);
    } else if (Array.isArray(input)) this.array(input, depth);
    else if (
      typeof input === "object" &&
      [Object.prototype, null].includes(Object.getPrototypeOf(input))
    )
      this.object(input, depth);
    else
      throw new Error(
        "Functions and executable values cannot be deployed to the device; use JSON-compatible literals",
      );
  }

  private number(input: number): void {
    if (!Number.isFinite(input)) throw new Error("Non-finite literal");
    const integral = Number.isSafeInteger(input);
    this.payload.u8(integral ? 3 : 4);
    this.payload.number(input, integral);
  }

  /** Bytes go packed (8), anything else one value each (6). */
  private array(input: unknown[], depth: number): void {
    const packed = input.every(isByte);
    this.payload.u8(packed ? 8 : 6);
    this.payload.u16(input.length);
    if (!packed) {
      input.forEach((entry) => this.value(entry, depth + 1));
      return;
    }
    this.values += input.length;
    if (this.values > LIMITS.values) throw new Error("Literal limit exceeded");
    this.payload.append(input as number[]);
  }

  private object(input: object, depth: number): void {
    this.payload.u8(7);
    const entries = Object.entries(input);
    this.payload.u16(entries.length);
    for (const [key, entry] of entries) {
      this.string(key);
      this.value(entry, depth + 1);
    }
  }

  private binding(input: Binding, depth = 0): void {
    if ("expr" in input) {
      const code = OPS[input.expr];
      if (code === undefined || depth >= 8 || input.args.length > MAX_ARGS)
        throw new Error(`Invalid expression: ${input.expr}`);
      this.payload.u8(2);
      this.payload.u8(code);
      this.payload.u8(input.args.length);
      input.args.forEach((arg) => this.binding(arg, depth + 1));
    } else if ("bind" in input) {
      this.payload.u8(1);
      this.string(input.bind);
      this.value(input.fallback);
    } else {
      this.payload.u8(0);
      this.value(input.literal);
    }
  }

  private layout(input: Layout): void {
    const direction = ["column", "row"].indexOf(input.direction);
    const align = ["start", "center", "end", "stretch"].indexOf(input.align);
    const justify = ["start", "center", "end", "between", "around", "evenly"].indexOf(input.justify);
    if (direction < 0 || align < 0 || justify < 0) throw new Error("Invalid layout");
    integer(input.gap, 0, LIMITS.viewport, "layout gap");
    input.padding.forEach((p) => integer(p, 0, LIMITS.viewport, "layout padding"));
    this.payload.u8(direction);
    this.payload.u8(align);
    this.payload.u8(justify);
    this.payload.u16(input.gap);
    input.padding.forEach((p) => this.payload.u16(p));
  }

  private writeSprite({ width, height, bits }: SpriteData): void {
    this.payload.u8(width);
    this.payload.u8(height);
    this.payload.append(Uint8Array.from(bits));
  }

  /** Optional packed sprite: width and height (0, 0 for none), then its rows. */
  private sprite(input: SpriteData | undefined, max: number, label: string): void {
    if (!input) {
      this.payload.u8(0);
      this.payload.u8(0);
      return;
    }
    checkSprite(input, max, label);
    this.writeSprite(input);
  }

  private node(input: Node, depth = 0): void {
    if (++this.nodes > LIMITS.nodes || depth > LIMITS.depth)
      throw new Error("Screen exceeds device layout limits");
    if (!Object.hasOwn(NODE_CODES, input.kind))
      throw new Error(`Unsupported device component: ${input.kind}`);
    this.payload.u8(opcode(input));
    const { x, y, width, height } = input.rect;
    integer(x, -LIMITS.viewport, LIMITS.viewport, "node x");
    integer(y, -LIMITS.viewport, LIMITS.viewport, "node y");
    if (!validDim(width) || !validDim(height)) throw new Error(`Invalid node size: ${width} × ${height}`);
    this.payload.i16(x);
    this.payload.i16(y);
    this.payload.u16(width);
    this.payload.u16(height);
    this.body(input, depth);
  }

  private children(items: Node[], depth: number): void {
    this.payload.u16(items.length);
    items.forEach((child) => this.node(child, depth + 1));
  }

  /** What follows a node's rectangle, by kind. */
  private body(input: Node, depth: number): void {
    switch (input.kind) {
      case "router":
        this.router(input, depth);
        break;
      case "group":
        if (input.layout) this.layout(input.layout);
        this.children(input.children, depth);
        break;
      case "panel":
        this.panel(input, depth);
        break;
      case "text":
        this.text(input);
        break;
      case "cartesianChart":
        this.cartesianChart(input);
        break;
      case "webImage":
        this.webImage(input);
        break;
      case "image":
        this.image(input);
        break;
      case "when":
      case "modal":
        this.binding(input.value);
        this.node(input.child, depth + 1);
        break;
      case "qr":
        this.qr(input);
        break;
      case "progress":
        this.binding(input.value);
        break;
      case "chart":
        this.binding(input.value);
        this.binding(input.max);
        break;
      case "plot":
        this.plot(input);
        break;
      case "button":
        this.button(input);
        break;
      case "repeat":
        integer(input.gap, 0, LIMITS.viewport, "list gap");
        this.binding(input.value);
        this.payload.u16(input.gap);
        this.node(input.child, depth + 1);
        break;
    }
  }

  private router(input: NodeOf<"router">, depth: number): void {
    if (++this.routers > 1) throw new Error("An app supports one Router");
    integer(input.routes.length, 1, 16, "route count");
    for (const route of input.routes) {
      if (!validIdentifier(route.name) || this.routeNames.has(route.name))
        throw new Error("Invalid or duplicate route");
      this.routeNames.add(route.name);
    }
    if (!this.routeNames.has(input.initial))
      throw new Error("Unknown initial route");
    this.string(input.initial);
    this.payload.u8(input.routes.length);
    for (const route of input.routes) {
      this.string(route.name);
      this.node(route.root, depth + 1);
    }
  }

  private panel(input: NodeOf<"panel">, depth: number): void {
    this.payload.u8(bit(input.inverted));
    // With a layout (opcode 29) the style is optional and flagged.
    if (input.layout) this.payload.u8(bit(input.style));
    if (input.style) this.surface(input.style, input.inverted);
    if (input.layout) this.layout(input.layout);
    this.children(input.children, depth);
  }

  private surface(s: SurfaceStyle, inverted: boolean): void {
    const borderWidth = s.borderWidth ?? (inverted ? 0 : 1);
    integer(s.radius ?? 255, 0, s.radius === undefined ? 255 : 254, "surface radius");
    integer(borderWidth, 0, 3, "border width");
    integer(s.opacity ?? 100, 0, 100, "surface opacity");
    const border = ["solid", "dashed", "dotted"].indexOf(s.borderStyle ?? "solid");
    const background = ["paper", "ink", "transparent"].indexOf(s.background ?? (inverted ? "ink" : "paper"));
    if (border < 0 || background < 0) throw new Error("Invalid surface style");
    this.payload.u8(s.radius ?? 255);
    this.payload.u8(borderWidth);
    this.payload.u8(border);
    this.payload.u8(background);
    this.payload.u8(s.opacity ?? 100);
    this.payload.u8(bit(s.shadow));
    if (s.shadow) this.shadow(s.shadow);
  }

  private shadow(shadow: NonNullable<SurfaceStyle["shadow"]>): void {
    const opacity = shadow.opacity ?? 50;
    integer(shadow.x, -16, 16, "shadow x");
    integer(shadow.y, -16, 16, "shadow y");
    integer(opacity, 0, 100, "shadow opacity");
    this.payload.i16(shadow.x);
    this.payload.i16(shadow.y);
    this.payload.u8(opacity);
  }

  private text(input: NodeOf<"text">): void {
    integer(input.maxLines, 1, 8, "text maxLines");
    this.payload.u8(FONTS.indexOf(input.font));
    this.payload.u8(ALIGNS.indexOf(input.align));
    this.payload.u8(bit(input.inverted));
    this.payload.u8(input.maxLines);
    if (input.typography) this.typography(input.typography);
    this.binding(input.value);
  }

  private typography(t: Typography): void {
    const family = FAMILIES.indexOf(t.fontFamily);
    const weight = WEIGHTS.indexOf(t.fontWeight);
    const sizes = FAMILY_SIZES[family] ?? CLASSIC_SIZES;
    const size = t.fontSize ?? 0;
    if (family < 0 || weight < 0 || !FONT_STYLES.has(t.fontStyle) || ![0, ...sizes].includes(size))
      throw new Error(`Invalid typography: ${t.fontFamily ?? "theme"} has no size ${t.fontSize} (${sizes.join(", ")})`);
    // Style byte: bit 0 italic, bit 1 shrink to fit.
    this.payload.u8(family);
    this.payload.u8(size);
    this.payload.u8(weight);
    this.payload.u8(bit(t.fontStyle === "italic") | (bit(t.fit) << 1));
    if (t.letterSpacing) {
      integer(t.letterSpacing, 0, 16, "letter spacing");
      this.payload.u8(t.letterSpacing);
    }
  }

  private cartesianChart(input: NodeOf<"cartesianChart">): void {
    integer(input.series.length, 1, 4, "chart series count");
    if (input.xKey && !validIdentifier(input.xKey))
      throw new Error("Invalid chart xKey");
    this.binding(input.data);
    this.binding(input.max);
    this.string(input.xKey);
    this.payload.u8(bit(input.axes));
    this.payload.u8(bit(input.grid));
    // Bit 0: legend; bit 1: stacked bars.
    this.payload.u8(bit(input.legend) | (bit(input.stacked) << 1));
    this.payload.u8(input.series.length);
    for (const series of input.series) {
      if (!validIdentifier(series.dataKey) || series.label.length > 64)
        throw new Error("Invalid chart series");
      this.string(series.dataKey);
      this.string(series.label);
      this.payload.u8(["line", "bar", "area"].indexOf(series.style));
      this.payload.u8(STROKES.indexOf(series.stroke));
    }
  }

  private webImage(input: NodeOf<"webImage">): void {
    integer(input.rect.width, 1, 256, "web image width");
    integer(input.rect.height, 1, 256, "web image height");
    if (
      "literal" in input.src &&
      (typeof input.src.literal !== "string" ||
        !validImageSource(input.src.literal))
    )
      throw new Error("Image src must be an HTTPS URL or same-origin path");
    if (input.fit !== "contain" && input.fit !== "cover")
      throw new Error("Invalid image fit");
    this.binding(input.src);
    this.payload.u8(bit(input.fit === "cover"));
  }

  private image(input: NodeOf<"image">): void {
    integer(input.sourceWidth, 1, LIMITS.viewport, "image width");
    integer(input.sourceHeight, 1, LIMITS.viewport, "image height");
    if (packedSprite(input)) {
      // Compiled art: raw rows, not one value per byte.
      this.payload.u16(input.sourceWidth);
      this.payload.u16(input.sourceHeight);
      this.payload.u8(bit(input.inverted));
      this.payload.append(Uint8Array.from((input.value as { literal: number[] }).literal));
      return;
    }
    this.binding(input.value);
    this.payload.u16(input.sourceWidth);
    this.payload.u16(input.sourceHeight);
    if (input.inverted) this.payload.u8(1);
  }

  private qr(input: NodeOf<"qr">): void {
    this.binding(input.value);
    if (!hasQrOptions(input)) return;
    const style = ["square", "dots", "rounded"].indexOf(input.style ?? "square");
    const ecc = ["low", "medium", "quartile", "high"].indexOf(input.ecc ?? "low");
    const quiet = input.quiet ?? 4;
    if (style < 0 || ecc < 0) throw new Error("Invalid QR style");
    integer(quiet, 0, 8, "QR quiet zone");
    this.payload.u8(style);
    this.payload.u8(ecc);
    this.payload.u8(quiet);
    this.sprite(input.logo, 128, "QR logo");
  }

  private plot(input: NodeOf<"plot">): void {
    this.binding(input.value);
    this.binding(input.max);
    this.payload.u8(STROKES.indexOf(input.stroke));
    this.payload.u8(bit(input.axes));
    if (!input.weight && !input.fill) return;
    const weight = input.weight ?? 1;
    const fill = input.fill ?? 0;
    integer(weight, 1, 4, "plot weight");
    integer(fill, 0, 100, "plot fill");
    this.payload.u8(weight);
    this.payload.u8(fill);
  }

  private button(input: NodeOf<"button">): void {
    if (!Object.hasOwn(this.scene.actions, input.action))
      throw new Error(`Button references unknown action: ${input.action}`);
    this.binding(input.label);
    this.string(input.action);
    if (input.variant && !BUTTON_VARIANTS.has(input.variant))
      throw new Error("Invalid button variant");
    if (input.variant === "ghost") {
      this.hardwareInput(input.input);
      this.payload.u8(2);
      this.sprite(input.icon, 64, "button icon");
      return;
    }
    if (input.input !== undefined || input.variant === "dock" || input.icon)
      this.hardwareInput(input.input);
    if (input.icon) {
      checkSprite(input.icon, 64, "button icon");
      this.payload.u8(bit(input.variant === "dock"));
      this.writeSprite(input.icon);
    }
  }

  /** The hardware input a button answers to, empty for none. */
  private hardwareInput(name: string | undefined): void {
    if (name !== undefined && !validIdentifier(name))
      throw new Error("Invalid hardware input name");
    this.string(name ?? "");
  }

  private resources(): void {
    const { resources } = this.scene;
    if (resources.length > LIMITS.resources)
      throw new Error("Resource limit exceeded");
    this.payload.u8(resources.length);
    for (const resource of resources) {
      checkResource(resource, this.resourceIds);
      this.resourceIds.add(resource.id);
      this.string(resource.id);
      this.string(resource.path);
      this.payload.u32(resource.refreshMs);
      this.payload.u8(bit(resource.onWake));
    }
  }

  private actions(): void {
    const actions = Object.entries(this.scene.actions);
    if (actions.length > LIMITS.actions) throw new Error("Action limit exceeded");
    this.payload.u16(actions.length);
    for (const [id, action] of actions) {
      if (!validIdentifier(id)) throw new Error("Invalid action identifier");
      this.string(id);
      this.action(action);
    }
  }

  private action(action: Action): void {
    switch (action.kind) {
      case "toast":
        this.toast(action);
        break;
      case "dialog":
        this.dialog(action);
        break;
      case "dialogChoice":
        this.payload.u8(7);
        this.payload.u8(bit(action.confirm));
        break;
      case "setState":
        this.checkStateKey(action.key);
        this.payload.u8(0);
        this.string(action.key);
        this.value(action.value);
        break;
      case "setStateBound":
        this.checkStateKey(action.key);
        this.payload.u8(9);
        this.string(action.key);
        this.binding(action.value);
        break;
      case "sequence":
        this.sequence(action);
        break;
      case "fetch":
        if (!this.resourceIds.has(action.resource))
          throw new Error(`Action references unknown resource: ${action.resource}`);
        this.payload.u8(1);
        this.string(action.resource);
        break;
      case "navigate":
        this.navigate(action);
        break;
      case "beep":
        this.payload.u8(3);
        this.payload.u8(TONES.indexOf(action.tone));
        break;
      case "emit":
        if (!validIdentifier(action.name)) throw new Error("Invalid event name");
        this.payload.u8(2);
        this.string(action.name);
        break;
      default:
        throw new Error("Invalid action");
    }
  }

  private checkStateKey(key: string): void {
    if (!Object.hasOwn(this.scene.state, key))
      throw new Error(`Action references unknown state: ${key}`);
  }

  private toast(action: ActionOf<"toast">): void {
    if (!validText(action.message))
      throw new Error("Toast message must be 1–256 UTF-8 bytes");
    integer(action.durationMs, 1000, 60000, "toast duration");
    this.payload.u8(5);
    this.string(action.message);
    this.payload.u32(action.durationMs);
  }

  private dialog(action: ActionOf<"dialog">): void {
    const texts = [action.title, action.message, action.confirmLabel, action.cancelLabel];
    if (!texts.every(validText))
      throw new Error("Dialog text must be 1–256 UTF-8 bytes");
    if (!Object.hasOwn(this.scene.actions, action.onConfirm))
      throw new Error("Unknown dialog confirmation action");
    this.payload.u8(6);
    for (const text of [...texts, action.onConfirm]) this.string(text);
  }

  private sequence(action: ActionOf<"sequence">): void {
    const { actions } = this.scene;
    integer(action.actions.length, 1, 8, "actions in a sequence");
    for (const step of action.actions)
      if (!Object.hasOwn(actions, step) || actions[step].kind === "sequence")
        throw new Error("A sequence runs existing, non-sequence actions");
    this.payload.u8(8);
    this.payload.u8(action.actions.length);
    action.actions.forEach((step) => this.string(step));
  }

  private navigate(action: ActionOf<"navigate">): void {
    this.payload.u8(4);
    this.payload.u8(NAVIGATIONS.indexOf(action.operation));
    if (
      action.operation !== "back" &&
      (!action.route || !validIdentifier(action.route))
    )
      throw new Error("Navigation needs a route");
    this.string(action.route ?? "");
  }

  /** Message table before the root (0xFF): locales, then each key's message per locale. */
  private messages(): void {
    const { messages } = this.scene;
    if (!messages || !Object.keys(messages.table).length) return;
    const { locales, table } = messages;
    integer(locales.length, 1, 8, "locales");
    this.payload.u8(0xff);
    this.payload.u8(locales.length);
    locales.forEach((locale) => this.string(locale));
    const keys = Object.keys(table).sort(byCodeUnit);
    integer(keys.length, 1, 65535, "messages");
    this.payload.u16(keys.length);
    for (const key of keys) {
      this.string(key);
      // A missing translation is empty: the device falls back to the default locale.
      locales.forEach((_, i) => this.string(table[key][i] ?? ""));
    }
  }

  private checkNavigation(): void {
    for (const action of Object.values(this.scene.actions)) {
      if (
        action.kind === "navigate" &&
        (!this.routers ||
          (action.operation !== "back" && !this.routeNames.has(action.route!)))
      )
        throw new Error("Navigation references an unknown route");
    }
  }
}
