/**
 * Translations in i18next's format, chosen on the device: the app's `locale` state wins, then the
 * host's `$device.locale`, then the first locale of the messages.
 *
 *   "hello": "{{name}}, bonne pause !"                       t("hello", { name })
 *   "stock_zero": "Plus rien",                                t("stock", { count })
 *   "stock_one": "{{count}} maté", "stock_other": "{{count}} matés"
 *   "side": "Droite", "side_left": "Gauche"                   t("side", { context: side })
 *
 * Plural forms follow the locale (fr: 0 and 1 are `one`), `_zero` wins for exactly 0, and a
 * context falls back to the base key. The build turns them into an ICU subset the engine reads.
 */
import type { Binding } from "./types";
import { translate } from "./expr";

/** Locale → key → message; the first locale is the default and defines the keys. */
export type Messages = Record<string, Record<string, string>>;
export type MessageTable = { locales: string[]; table: Record<string, string[]> };

/** i18next's plural suffixes, in ICU's branch order; `_zero` is i18next's "exactly 0". */
const FORMS = ["zero", "one", "two", "few", "many", "other"] as const;
const SUFFIX = new RegExp(`^(.+)_(${FORMS.join("|")})$`);
type Form = (typeof FORMS)[number];
/** A message key as `t` takes it: plural forms share their base key, so do contexts. */
export type MessageKey<K> = K extends `${infer Base}_${Form}` ? Base : K extends `${infer Base}_${string}` ? Base | K : K;

const INTERPOLATION = /\{\{\s*([\w.]+)\s*\}\}/g;
/** i18next's `{{name}}` as ICU's `{name}`; in a plural form, `{{count}}` is ICU's `#`. */
const icu = (text: string, plural = false) =>
  text.replace(INTERPOLATION, (_, name: string) => (plural && name === "count" ? "#" : `{${name}}`));

/** One locale's messages with i18next plural forms folded into ICU plurals on `count`. */
function normalize(locale: string, entries: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const plurals: Record<string, Partial<Record<Form, string>>> = {};
  for (const [key, text] of Object.entries(entries)) {
    if (/[{}]/.test(text.replace(INTERPOLATION, "")))
      throw new Error(`Message ${locale}.${key}: interpolate with {{name}}, plurals with ${key}_one / ${key}_other (i18next)`);
    const match = SUFFIX.exec(key);
    if (match && !(match[1] in entries)) {
      const forms = plurals[match[1]] ?? {};
      forms[match[2] as Form] = text;
      plurals[match[1]] = forms;
    } else out[key] = icu(text);
  }
  for (const [base, forms] of Object.entries(plurals)) {
    if (forms.other === undefined) throw new Error(`Message ${locale}.${base}: plural forms need ${base}_other`);
    const branches = FORMS.filter((form) => forms[form] !== undefined).map(
      (form) => `${form === "zero" ? "=0" : form} {${icu(forms[form]!, true)}}`,
    );
    out[base] = `{count, plural, ${branches.join(" ")}}`;
  }
  return out;
}

export function defineMessages<const M extends Messages>(messages: M): M {
  const normalized = Object.fromEntries(
    Object.entries(messages).map(([locale, entries]) => [locale, normalize(locale, entries)]),
  ) as Messages;
  const [first, ...others] = Object.keys(normalized);
  if (!first) throw new Error("defineMessages needs at least one locale");
  for (const locale of others)
    for (const key of Object.keys(normalized[locale]))
      if (!(key in normalized[first])) throw new Error(`Message ${locale}.${key} has no ${first} original`);
  return normalized as M;
}

/** Add one key of `messages` (every locale) to a scene's table; the first locale ever seen is the default. */
export function register(target: MessageTable, messages: Messages, key: string): void {
  for (const locale of Object.keys(messages)) if (!target.locales.includes(locale)) target.locales.push(locale);
  if (target.locales.length > 8) throw new Error("At most 8 locales");
  const row = (target.table[key] ??= []);
  for (const [locale, entries] of Object.entries(messages))
    if (key in entries) row[target.locales.indexOf(locale)] = entries[key];
}

export type Translate<M extends Messages> = (key: MessageKey<keyof M[keyof M] & string>, params?: Record<string, unknown>) => Binding;

/**
 * A `t` for these messages: `t("stock", { count })` is a binding to the translated text. Only the
 * keys a screen uses go into its bytecode.
 */
export function translator<M extends Messages>(messages: M, table: MessageTable): Translate<M> {
  const defaults = messages[Object.keys(messages)[0]];
  return (key, params = {}) => {
    if (Object.keys(params).length > 7) throw new Error("A message takes at most 7 arguments");
    if ("context" in params) return contextual(messages, table, key, params);
    if (!(key in defaults)) throw new Error(`Unknown message: ${key}`);
    register(table, messages, key);
    return translate(key, params);
  };
}

/**
 * i18next's context: `key_<context>` when the context has a variant, `key` otherwise. One select
 * on the device, so the context may change at run time (a binding).
 */
function contextual(messages: Messages, table: MessageTable, key: string, params: Record<string, unknown>): Binding {
  const prefix = `${key}_`;
  const variants = (entries: Record<string, string>) => Object.keys(entries).filter((k) => k.startsWith(prefix));
  const first = messages[Object.keys(messages)[0]];
  if (!(key in first) && variants(first).length === 0) throw new Error(`Unknown message: ${key} (with a context)`);
  // A name no message key can take: it holds the select, per locale.
  const name = `${key}#context`;
  const selects: Messages = {};
  for (const [locale, entries] of Object.entries(messages)) {
    const options = variants(entries).map((k) => `${k.slice(prefix.length)} {${entries[k]}}`);
    const other = `other {${entries[key] ?? ""}}`;
    if (options.length > 0 || key in entries)
      selects[locale] = { [name]: `{context, select, ${[...options, other].join(" ")}}` };
  }
  register(table, selects, name);
  return translate(name, params);
}
