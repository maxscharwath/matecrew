/** DUI1 encoder. Geometry and node kinds are opcodes; only values and bindings use strings. */
import { Writer, integer } from "./writer";
import type { Binding, Node, SceneDefinition } from "./types";
import {
  LIMITS,
  validApiPath,
  validIdentifier,
  validImageSource,
} from "./limits";

const NODE_CODES = {
  group: 0,
  row: 1,
  column: 2,
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
const utf8 = new TextEncoder();

export function encodeScene(scene: SceneDefinition): Uint8Array {
  if (scene.version !== 1) throw new Error("Unsupported scene version");
  integer(scene.width, 1, LIMITS.viewport, "viewport width");
  integer(scene.height, 1, LIMITS.viewport, "viewport height");
  const payload = new Writer();
  const strings = new Map<string, number>();
  let values = 0;
  let nodes = 0;
  const routeNames = new Set<string>();
  let routers = 0;

  function string(input: string): void {
    if (typeof input !== "string") throw new Error("Expected string");
    let index = strings.get(input);
    if (index === undefined) {
      if (strings.size >= LIMITS.strings)
        throw new Error("String limit exceeded");
      index = strings.size;
      strings.set(input, index);
    }
    payload.u16(index);
  }
  function value(input: unknown, depth = 0): void {
    if (++values > LIMITS.values || depth > LIMITS.depth)
      throw new Error(
        "Literal limit exceeded: value is too large, deep or cyclic",
      );
    if (input == null) {
      payload.u8(0);
      return;
    }
    if (typeof input === "boolean") {
      payload.u8(input ? 2 : 1);
      return;
    }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new Error("Non-finite literal");
      const integral = Number.isSafeInteger(input);
      payload.u8(integral ? 3 : 4);
      payload.number(input, integral);
      return;
    }
    if (typeof input === "string") {
      payload.u8(5);
      string(input);
      return;
    }
    if (Array.isArray(input)) {
      const packed = input.every(
        (entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255,
      );
      payload.u8(packed ? 8 : 6);
      payload.u16(input.length);
      if (packed) {
        values += input.length;
        if (values > LIMITS.values) throw new Error("Literal limit exceeded");
        payload.append(input);
      } else {
        input.forEach((entry) => value(entry, depth + 1));
      }
      return;
    }
    if (
      typeof input === "object" &&
      [Object.prototype, null].includes(Object.getPrototypeOf(input))
    ) {
      payload.u8(7);
      const entries = Object.entries(input);
      payload.u16(entries.length);
      for (const [key, entry] of entries) {
        string(key);
        value(entry, depth + 1);
      }
      return;
    }
    throw new Error(
      "Functions and executable values cannot be deployed to the device; use JSON-compatible literals",
    );
  }
  function binding(input: Binding): void {
    if ("bind" in input) {
      payload.u8(1);
      string(input.bind);
      value(input.fallback);
    } else {
      payload.u8(0);
      value(input.literal);
    }
  }
  function node(input: Node, depth = 0): void {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth)
      throw new Error("Screen exceeds device layout limits");
    if (!Object.hasOwn(NODE_CODES, input.kind))
      throw new Error(`Unsupported device component: ${input.kind}`);
    payload.u8(
      input.kind === "text" && input.typography ? 21 : input.kind === "panel" && input.style ? 20 : input.kind === "button" && input.icon
        ? 18
        : input.kind === "button" && input.variant === "dock"
          ? 17
          : input.kind === "button" && input.input !== undefined
            ? 15
            : NODE_CODES[input.kind],
    );
    const { x, y, width, height } = input.rect;
    integer(x, -LIMITS.viewport, LIMITS.viewport, "node x");
    integer(y, -LIMITS.viewport, LIMITS.viewport, "node y");
    integer(width, 0, LIMITS.viewport, "node width");
    integer(height, 0, LIMITS.viewport, "node height");
    payload.i16(x);
    payload.i16(y);
    payload.u16(width);
    payload.u16(height);
    function children(items: Node[]): void {
      payload.u16(items.length);
      items.forEach((child) => node(child, depth + 1));
    }
    switch (input.kind) {
      case "router":
        if (++routers > 1) throw new Error("An app supports one Router");
        integer(input.routes.length, 1, 16, "route count");
        for (const route of input.routes) {
          if (!validIdentifier(route.name) || routeNames.has(route.name))
            throw new Error("Invalid or duplicate route");
          routeNames.add(route.name);
        }
        if (!routeNames.has(input.initial))
          throw new Error("Unknown initial route");
        string(input.initial);
        payload.u8(input.routes.length);
        for (const route of input.routes) {
          string(route.name);
          node(route.root, depth + 1);
        }
        break;
      case "group":
        children(input.children);
        break;
      case "row":
      case "column":
        integer(input.gap, 0, LIMITS.viewport, "layout gap");
        payload.u16(input.gap);
        children(input.children);
        break;
      case "panel":
        payload.u8(input.inverted ? 1 : 0);
        if (input.style) {
          const s = input.style;
          integer(s.radius ?? 255, 0, s.radius === undefined ? 255 : 64, "surface radius");
          integer(s.borderWidth ?? (input.inverted ? 0 : 1), 0, 3, "border width");
          integer(s.opacity ?? 100, 0, 100, "surface opacity");
          const border = ["solid", "dashed", "dotted"].indexOf(s.borderStyle ?? "solid");
          const background = ["paper", "ink", "transparent"].indexOf(s.background ?? (input.inverted ? "ink" : "paper"));
          if (border < 0 || background < 0) throw new Error("Invalid surface style");
          payload.u8(s.radius ?? 255);
          payload.u8(s.borderWidth ?? (input.inverted ? 0 : 1));
          payload.u8(border); payload.u8(background); payload.u8(s.opacity ?? 100);
          payload.u8(s.shadow ? 1 : 0);
          if (s.shadow) {
            integer(s.shadow.x, -16, 16, "shadow x"); integer(s.shadow.y, -16, 16, "shadow y");
            integer(s.shadow.opacity ?? 50, 0, 100, "shadow opacity");
            payload.i16(s.shadow.x); payload.i16(s.shadow.y); payload.u8(s.shadow.opacity ?? 50);
          }
        }
        children(input.children);
        break;
      case "text":
        integer(input.maxLines, 1, 8, "text maxLines");
        payload.u8(FONTS.indexOf(input.font));
        payload.u8(ALIGNS.indexOf(input.align));
        payload.u8(input.inverted ? 1 : 0);
        payload.u8(input.maxLines);
        if (input.typography) {
          const t = input.typography;
          const family = [undefined, "pixel", "sans", "mono"].indexOf(t.fontFamily);
          const weight = [undefined, "normal", "bold"].indexOf(t.fontWeight);
          if (family < 0 || weight < 0 || ![undefined, "normal", "italic"].includes(t.fontStyle) || ![0, 8, 10, 12, 14, 18, 24].includes(t.fontSize ?? 0)) throw new Error("Invalid typography");
          payload.u8(family); payload.u8(t.fontSize ?? 0); payload.u8(weight); payload.u8(t.fontStyle === "italic" ? 1 : 0);
        }
        binding(input.value);
        break;
      case "cartesianChart":
        integer(input.series.length, 1, 4, "chart series count");
        if (input.xKey && !validIdentifier(input.xKey))
          throw new Error("Invalid chart xKey");
        binding(input.data);
        binding(input.max);
        string(input.xKey);
        payload.u8(input.axes ? 1 : 0);
        payload.u8(input.grid ? 1 : 0);
        payload.u8(input.legend ? 1 : 0);
        payload.u8(input.series.length);
        for (const series of input.series) {
          if (!validIdentifier(series.dataKey) || series.label.length > 64)
            throw new Error("Invalid chart series");
          string(series.dataKey);
          string(series.label);
          payload.u8(["line", "bar", "area"].indexOf(series.style));
          payload.u8(["solid", "dotted", "dashed"].indexOf(series.stroke));
        }
        break;
      case "webImage":
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
        binding(input.src);
        payload.u8(input.fit === "cover" ? 1 : 0);
        break;
      case "image":
        integer(input.sourceWidth, 1, LIMITS.viewport, "image width");
        integer(input.sourceHeight, 1, LIMITS.viewport, "image height");
        binding(input.value);
        payload.u16(input.sourceWidth);
        payload.u16(input.sourceHeight);
        break;
      case "when":
      case "modal":
        binding(input.value);
        node(input.child, depth + 1);
        break;
      case "qr":
      case "progress":
        binding(input.value);
        break;
      case "chart":
        binding(input.value);
        binding(input.max);
        break;
      case "plot":
        binding(input.value);
        binding(input.max);
        payload.u8(["solid", "dotted", "dashed"].indexOf(input.stroke));
        payload.u8(input.axes ? 1 : 0);
        break;
      case "button":
        if (!Object.hasOwn(scene.actions, input.action))
          throw new Error(`Button references unknown action: ${input.action}`);
        binding(input.label);
        string(input.action);
        if (input.variant && !["default", "dock"].includes(input.variant))
          throw new Error("Invalid button variant");
        if (
          input.input !== undefined ||
          input.variant === "dock" ||
          input.icon
        ) {
          if (input.input !== undefined && !validIdentifier(input.input))
            throw new Error("Invalid hardware input name");
          string(input.input ?? "");
        }
        if (input.icon) {
          const { width, height, bits } = input.icon;
          integer(width, 1, 64, "button icon width");
          integer(height, 1, 64, "button icon height");
          if (
            bits.length !== Math.ceil((width * height) / 8) ||
            bits.some((b) => !Number.isInteger(b) || b < 0 || b > 255)
          )
            throw new Error("Invalid button icon pixels");
          payload.u8(input.variant === "dock" ? 1 : 0);
          payload.u8(width);
          payload.u8(height);
          payload.append(Uint8Array.from(bits));
        }
        break;
      case "repeat":
        integer(input.gap, 0, LIMITS.viewport, "list gap");
        binding(input.value);
        payload.u16(input.gap);
        node(input.child, depth + 1);
        break;
    }
  }

  if (scene.resources.length > LIMITS.resources)
    throw new Error("Resource limit exceeded");
  const ids = new Set<string>();
  payload.u8(scene.resources.length);
  for (const resource of scene.resources) {
    if (
      !validIdentifier(resource.id) ||
      resource.id === "local" ||
      ids.has(resource.id) ||
      !validApiPath(resource.path)
    )
      throw new Error("Invalid or duplicate resource");
    ids.add(resource.id);
    string(resource.id);
    string(resource.path);
    payload.u32(resource.refreshMs);
    payload.u8(resource.onWake ? 1 : 0);
  }
  if (
    !scene.state ||
    Array.isArray(scene.state) ||
    typeof scene.state !== "object" ||
    Object.keys(scene.state).some((key) => !validIdentifier(key))
  )
    throw new Error("Invalid local state");
  value(scene.state);
  if (utf8.encode(JSON.stringify(scene.state)).length > LIMITS.localState)
    throw new Error("Local state exceeds device size limit");
  const actions = Object.entries(scene.actions);
  if (actions.length > LIMITS.actions) throw new Error("Action limit exceeded");
  payload.u16(actions.length);
  for (const [id, action] of actions) {
    if (!validIdentifier(id)) throw new Error("Invalid action identifier");
    string(id);
    switch (action.kind) {
      case "toast":
        if (!action.message || utf8.encode(action.message).length > 256)
          throw new Error("Toast message must be 1–256 UTF-8 bytes");
        integer(action.durationMs, 1000, 60000, "toast duration");
        payload.u8(5);
        string(action.message);
        payload.u32(action.durationMs);
        break;
      case "dialog":
        for (const text of [
          action.title,
          action.message,
          action.confirmLabel,
          action.cancelLabel,
        ])
          if (!text || utf8.encode(text).length > 256)
            throw new Error("Dialog text must be 1–256 UTF-8 bytes");
        if (!Object.hasOwn(scene.actions, action.onConfirm))
          throw new Error("Unknown dialog confirmation action");
        payload.u8(6);
        for (const text of [
          action.title,
          action.message,
          action.confirmLabel,
          action.cancelLabel,
          action.onConfirm,
        ])
          string(text);
        break;
      case "dialogChoice":
        payload.u8(7);
        payload.u8(action.confirm ? 1 : 0);
        break;
      case "setState":
        if (!Object.hasOwn(scene.state, action.key))
          throw new Error(`Action references unknown state: ${action.key}`);
        payload.u8(0);
        string(action.key);
        value(action.value);
        break;
      case "fetch":
        if (!ids.has(action.resource))
          throw new Error(
            `Action references unknown resource: ${action.resource}`,
          );
        payload.u8(1);
        string(action.resource);
        break;
      case "navigate":
        payload.u8(4);
        payload.u8(
          ["push", "replace", "back", "reset"].indexOf(action.operation),
        );
        if (
          action.operation !== "back" &&
          (!action.route || !validIdentifier(action.route))
        )
          throw new Error("Navigation needs a route");
        string(action.route ?? "");
        break;
      case "beep":
        payload.u8(3);
        payload.u8(
          ["key", "success", "error", "notification"].indexOf(action.tone),
        );
        break;
      case "emit":
        if (!validIdentifier(action.name))
          throw new Error("Invalid event name");
        payload.u8(2);
        string(action.name);
        break;
      default:
        throw new Error("Invalid action");
    }
  }
  node(scene.root);
  for (const action of Object.values(scene.actions)) {
    if (
      action.kind === "navigate" &&
      (!routers ||
        (action.operation !== "back" && !routeNames.has(action.route!)))
    )
      throw new Error("Navigation references an unknown route");
  }
  const out = new Writer();
  out.append([68, 85, 73, 49]); // DUI1
  out.u16(scene.width);
  out.u16(scene.height);
  out.u16(strings.size);
  for (const input of strings.keys()) {
    const encoded = utf8.encode(input);
    out.u16(encoded.length);
    out.append(encoded);
  }
  out.append(payload.bytes);
  return Uint8Array.from(out.bytes);
}
