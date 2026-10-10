/**
 * Expressions: values computed on the device from data, like `{a > 0 ? "x" : "y"}` in React,
 * but compiled. Each builder returns a binding the engine evaluates (engine/src/scene/expr.rs).
 *
 *   fmt`Bonne pause ${name} !`        cond(gt(stock, 0), "En stock", "Épuisé")
 *   add(count, 1)                      not(open)
 */
import type { Binding } from "./types";

/** Operator codes, shared with engine/src/scene/expr.rs. */
export const OPS = {
  concat: 0,
  eq: 1,
  ne: 2,
  lt: 3,
  lte: 4,
  gt: 5,
  gte: 6,
  and: 7,
  or: 8,
  not: 9,
  add: 10,
  sub: 11,
  mul: 12,
  div: 13,
  mod: 14,
  min: 15,
  max: 16,
  round: 17,
  cond: 18,
  len: 19,
  upper: 20,
  lower: 21,
  fixed: 22,
  coalesce: 23,
  pad: 24,
  t: 25,
} as const;
export type Op = keyof typeof OPS;
export const MAX_ARGS = 16;

/** Anything a component accepts as a value, as a binding: a literal, a binding or an expression. */
export function toBinding(input: unknown): Binding {
  if (input && typeof input === "object" && ("bind" in input || "literal" in input || "expr" in input))
    return input as Binding;
  return { literal: input };
}
/** A literal binding stays a JavaScript value: expressions over literals fold at compile time. */
const literal = (b: Binding): b is { literal: unknown } => "literal" in b;

function expr(op: Op, args: unknown[]): Binding {
  if (args.length > MAX_ARGS) throw new Error(`${op}: at most ${MAX_ARGS} arguments`);
  return { expr: op, args: args.map(toBinding) };
}

/** A folded literal as the engine reads it: text as is, numbers and booleans written out, nothing else. */
function literalText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
}

/** Template text: `fmt\`${count} en stock\``. Pure literals fold to a plain string. */
export function fmt(strings: TemplateStringsArray, ...values: unknown[]): Binding {
  const parts: unknown[] = [];
  strings.forEach((text, i) => {
    if (text) parts.push(text);
    if (i < values.length) parts.push(values[i]);
  });
  const bindings = parts.map(toBinding);
  if (bindings.every(literal)) return { literal: bindings.map((b) => literalText(b.literal)).join("") };
  return expr("concat", parts.length ? parts : [""]);
}
export const concat = (...parts: unknown[]) => expr("concat", parts);
export const eq = (a: unknown, b: unknown) => expr("eq", [a, b]);
export const ne = (a: unknown, b: unknown) => expr("ne", [a, b]);
export const lt = (a: unknown, b: unknown) => expr("lt", [a, b]);
export const lte = (a: unknown, b: unknown) => expr("lte", [a, b]);
export const gt = (a: unknown, b: unknown) => expr("gt", [a, b]);
export const gte = (a: unknown, b: unknown) => expr("gte", [a, b]);
export const and = (...values: unknown[]) => expr("and", values);
export const or = (...values: unknown[]) => expr("or", values);
export const not = (value: unknown) => expr("not", [value]);
export const add = (...values: unknown[]) => expr("add", values);
export const sub = (a: unknown, b: unknown) => expr("sub", [a, b]);
export const mul = (...values: unknown[]) => expr("mul", values);
export const div = (a: unknown, b: unknown) => expr("div", [a, b]);
export const mod = (a: unknown, b: unknown) => expr("mod", [a, b]);
export const min = (...values: unknown[]) => expr("min", values);
export const max = (...values: unknown[]) => expr("max", values);
export const round = (value: unknown) => expr("round", [value]);
/** `test ? then : otherwise`, decided on the device (JavaScript truthiness). */
export const cond = (test: unknown, then: unknown, otherwise: unknown = "") => expr("cond", [test, then, otherwise]);
export const len = (value: unknown) => expr("len", [value]);
export const upper = (value: unknown) => expr("upper", [value]);
export const lower = (value: unknown) => expr("lower", [value]);
/** A number with `digits` decimals, as text. */
export const fixed = (value: unknown, digits: number) => expr("fixed", [value, digits]);
/** The first value that is neither null nor empty. */
export const coalesce = (...values: unknown[]) => expr("coalesce", values);
/** An integer padded with zeros to `width` digits: `pad(2, 2)` reads "02". */
export const pad = (value: unknown, width: number) => expr("pad", [value, width]);

/** Internal: the translate operator (see `useI18n`). */
export function translate(key: string, params: Record<string, unknown> = {}): Binding {
  return expr("t", [key, ...Object.entries(params).flatMap(([name, value]) => [name, value])]);
}
