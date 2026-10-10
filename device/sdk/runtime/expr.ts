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

/** Anything a component accepts as a value: a literal, a binding or an expression. */
export type Value = unknown;

export function toBinding(input: Value): Binding {
  if (input && typeof input === "object" && ("bind" in input || "literal" in input || "expr" in input))
    return input as Binding;
  return { literal: input };
}
/** A literal binding stays a JavaScript value: expressions over literals fold at compile time. */
const literal = (b: Binding): b is { literal: unknown } => "literal" in b;

function expr(op: Op, args: Value[]): Binding {
  if (args.length > MAX_ARGS) throw new Error(`${op}: at most ${MAX_ARGS} arguments`);
  return { expr: op, args: args.map(toBinding) };
}

/** Template text: `fmt\`${count} en stock\``. Pure literals fold to a plain string. */
export function fmt(strings: TemplateStringsArray, ...values: Value[]): Binding {
  const parts: Value[] = [];
  strings.forEach((text, i) => {
    if (text) parts.push(text);
    if (i < values.length) parts.push(values[i]);
  });
  const bindings = parts.map(toBinding);
  if (bindings.every(literal)) return { literal: bindings.map((b) => String(b.literal ?? "")).join("") };
  return expr("concat", parts.length ? parts : [""]);
}
export const concat = (...parts: Value[]) => expr("concat", parts);
export const eq = (a: Value, b: Value) => expr("eq", [a, b]);
export const ne = (a: Value, b: Value) => expr("ne", [a, b]);
export const lt = (a: Value, b: Value) => expr("lt", [a, b]);
export const lte = (a: Value, b: Value) => expr("lte", [a, b]);
export const gt = (a: Value, b: Value) => expr("gt", [a, b]);
export const gte = (a: Value, b: Value) => expr("gte", [a, b]);
export const and = (...values: Value[]) => expr("and", values);
export const or = (...values: Value[]) => expr("or", values);
export const not = (value: Value) => expr("not", [value]);
export const add = (...values: Value[]) => expr("add", values);
export const sub = (a: Value, b: Value) => expr("sub", [a, b]);
export const mul = (...values: Value[]) => expr("mul", values);
export const div = (a: Value, b: Value) => expr("div", [a, b]);
export const mod = (a: Value, b: Value) => expr("mod", [a, b]);
export const min = (...values: Value[]) => expr("min", values);
export const max = (...values: Value[]) => expr("max", values);
export const round = (value: Value) => expr("round", [value]);
/** `test ? then : otherwise`, decided on the device (JavaScript truthiness). */
export const cond = (test: Value, then: Value, otherwise: Value = "") => expr("cond", [test, then, otherwise]);
export const len = (value: Value) => expr("len", [value]);
export const upper = (value: Value) => expr("upper", [value]);
export const lower = (value: Value) => expr("lower", [value]);
/** A number with `digits` decimals, as text. */
export const fixed = (value: Value, digits: number) => expr("fixed", [value, digits]);
/** The first value that is neither null nor empty. */
export const coalesce = (...values: Value[]) => expr("coalesce", values);
/** An integer padded with zeros to `width` digits: `pad(2, 2)` reads "02". */
export const pad = (value: Value, width: number) => expr("pad", [value, width]);

/** Internal: the translate operator (see `useI18n`). */
export function translate(key: string, params: Record<string, Value> = {}): Binding {
  return expr("t", [key, ...Object.entries(params).flatMap(([name, value]) => [name, value])]);
}
