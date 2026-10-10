import type { TargetColumn, TargetTable } from "./schema";

/**
 * Turning Postgres rows into D1 SQL: pure functions, unit-tested in
 * tests/db/copy-db.test.ts.
 *
 * Values arrive as node-postgres gives them, with dates and timestamps kept as
 * the server's text (see `SOURCE_TYPE_PARSERS` in ../copy-db.ts) so no local
 * time zone is ever applied, and leave as SQL literals in the encoding Prisma's
 * D1 adapter writes: DateTime as ISO text with "+00:00", Boolean as 1/0,
 * Bytes as a blob, money as integer cents.
 */

export type SourceValue = string | number | boolean | bigint | Uint8Array | readonly string[] | null;
export type SourceRow = Readonly<Record<string, SourceValue>>;

/** Target columns whose source column has another name (money became cents). */
export const RENAMED_COLUMNS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  PurchaseBatch: { totalPriceCents: "totalPrice" },
  PurchaseLine: { unitPriceCents: "unitPrice", lineTotalCents: "lineTotal" },
  ReimbursementLine: { amountCents: "amount" },
};

/** Target tables built from another source table rather than copied. */
export const DERIVED_TABLES: Readonly<Record<string, string>> = { MembershipRole: "Membership" };

/** What a transform had to round; the export refuses to write when it is not empty, unless told to. */
export interface TransformReport {
  readonly inexact: string[];
}

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * A Postgres numeric, as text, to integer cents. Exact for up to two
 * decimals, which is all `Decimal(10,2)` holds; a longer fraction is rounded
 * half away from zero and flagged as inexact.
 */
export function decimalToCents(value: string): { cents: number; exact: boolean } {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new RangeError(`Not a decimal: ${value}`);
  const [, sign, whole, fraction = ""] = match;
  const kept = Number(`${whole}${fraction.padEnd(2, "0").slice(0, 2)}`);
  const rest = fraction.slice(2);
  const roundsUp = rest.length > 0 && Number(rest[0]) >= 5;
  const magnitude = kept + (roundsUp ? 1 : 0);
  if (!Number.isSafeInteger(magnitude)) throw new RangeError(`Out of range: ${value}`);
  return { cents: sign === "-" && magnitude !== 0 ? -magnitude : magnitude, exact: /^0*$/.test(rest) };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_OFFSET = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * A Postgres `date`, `timestamp` (Prisma stores UTC there) or `timestamptz`,
 * as text, to the text Prisma's D1 adapter stores: "2026-10-10T12:00:00.000+00:00".
 */
export function toD1DateTime(value: string): string {
  const text = value.trim();
  if (DATE_ONLY.test(text)) return `${text}T00:00:00.000+00:00`;
  // Postgres writes offsets as "+01" or "+0130"; JavaScript wants "+01:00".
  const iso = text
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(HAS_OFFSET.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Not a timestamp: ${value}`);
  return date.toISOString().replace("Z", "+00:00");
}

function quote(text: string): string {
  if (text.includes("\u0000")) throw new RangeError("Text with a NUL character cannot be written as a literal");
  return `'${text.replaceAll("'", "''")}'`;
}

function blobLiteral(bytes: Uint8Array): string {
  return `X'${Buffer.from(bytes).toString("hex").toUpperCase()}'`;
}

function integerLiteral(value: SourceValue, where: string): string {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new RangeError(`${where}: not an integer: ${String(value)}`);
  return String(number);
}

function realLiteral(value: SourceValue, where: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${where}: not a finite number: ${String(value)}`);
  return String(number);
}

function textLiteral(value: SourceValue): string {
  // Device.syncTimes was a text[]: it becomes the comma-separated list the app parses.
  if (Array.isArray(value)) return quote(value.join(","));
  return quote(String(value));
}

/** One value as the SQL literal of its target column. */
export function toLiteral(value: SourceValue, column: TargetColumn, where: string): string {
  if (value === null) {
    if (column.notNull) throw new RangeError(`${where}: NULL in a NOT NULL column`);
    return "NULL";
  }
  switch (column.type) {
    case "BOOLEAN":
      return value === true || value === "t" ? "1" : "0";
    case "DATETIME":
      return quote(toD1DateTime(String(value)));
    case "BLOB":
      if (!(value instanceof Uint8Array)) throw new RangeError(`${where}: not bytes`);
      return blobLiteral(value);
    case "INTEGER":
      return integerLiteral(value, where);
    case "REAL":
      return realLiteral(value, where);
    default:
      return textLiteral(value);
  }
}

/** A money column read from its Decimal source, as cents. */
function centsLiteral(value: SourceValue, column: TargetColumn, where: string, report: TransformReport): string {
  if (value === null) return toLiteral(null, column, where);
  const { cents, exact } = decimalToCents(String(value));
  if (!exact) report.inexact.push(`${where}: ${String(value)} rounded to ${cents} cents`);
  return String(cents);
}

/** A source row as the literals of the target table's columns, in column order. */
export function rowLiterals(table: TargetTable, row: SourceRow, report: TransformReport): string[] {
  const renamed = RENAMED_COLUMNS[table.name] ?? {};
  const rowId = table.primaryKey.map((key) => String(row[key])).join("/");
  return table.columns.map((column) => {
    const sourceName = renamed[column.name];
    const where = `${table.name}.${column.name} (${rowId})`;
    if (sourceName) return centsLiteral(row[sourceName] ?? null, column, where, report);
    // A column the source does not have yet (Item.terminalPhoto) starts empty.
    return toLiteral(column.name in row ? row[column.name] : null, column, where);
  });
}

/** The `MembershipRole` rows of one source membership: one per role. */
export function membershipRoleRows(membership: SourceRow): SourceRow[] {
  const roles = membership.roles;
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new RangeError(`Membership ${String(membership.id)} has no roles`);
  }
  return [...new Set(roles)].map((role) => ({ membershipId: membership.id, role }));
}

function identifier(name: string): string {
  return `"${name}"`;
}

export interface StatementLimits {
  /** Longest statement written, in bytes; D1 refuses statements over 100 000. */
  readonly maxStatementBytes: number;
}

export const D1_LIMITS: StatementLimits = { maxStatementBytes: 90_000 };

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * A row too long for one statement: inserted with its long blobs empty, then
 * each blob appended in chunks (`unhex(hex(column) || '...')`, binary-safe).
 */
function splitRow(table: TargetTable, literals: readonly string[], limits: StatementLimits): string[] {
  const columns = table.columns.map((c) => identifier(c.name)).join(", ");
  const blobIndexes = table.columns.flatMap((c, i) => (c.type === "BLOB" && literals[i].length > 1_000 ? [i] : []));
  const shortened = literals.map((literal, i) => (blobIndexes.includes(i) ? "X''" : literal));
  const insert = `INSERT INTO ${identifier(table.name)} (${columns}) VALUES (${shortened.join(", ")});`;
  if (byteLength(insert) > limits.maxStatementBytes) {
    throw new RangeError(`${table.name}: a row is too long for one statement even without its blobs`);
  }
  const match = table.primaryKey
    .map((key) => `${identifier(key)} = ${literals[table.columns.findIndex((c) => c.name === key)]}`)
    .join(" AND ");
  const chunkChars = limits.maxStatementBytes - byteLength(match) - 200;
  const appends = blobIndexes.flatMap((i) => {
    const hex = literals[i].slice(2, -1);
    const column = identifier(table.columns[i].name);
    const chunks: string[] = [];
    for (let at = 0; at < hex.length; at += chunkChars - (chunkChars % 2)) {
      chunks.push(hex.slice(at, at + chunkChars - (chunkChars % 2)));
    }
    return chunks.map(
      (chunk) => `UPDATE ${identifier(table.name)} SET ${column} = unhex(hex(${column}) || '${chunk}') WHERE ${match};`,
    );
  });
  return [insert, ...appends];
}

/**
 * INSERT statements for a table's rows: as many rows per statement as fit
 * under the limit, and a long row split across several statements.
 */
export function insertStatements(
  table: TargetTable,
  rows: readonly (readonly string[])[],
  limits: StatementLimits = D1_LIMITS,
): string[] {
  const head = `INSERT INTO ${identifier(table.name)} (${table.columns.map((c) => identifier(c.name)).join(", ")}) VALUES\n`;
  const statements: string[] = [];
  let pending: string[] = [];
  let size = byteLength(head);
  const flush = () => {
    if (pending.length > 0) statements.push(`${head}${pending.join(",\n")};`);
    pending = [];
    size = byteLength(head);
  };
  for (const literals of rows) {
    const tuple = `(${literals.join(", ")})`;
    const tupleBytes = byteLength(tuple) + 2;
    if (byteLength(head) + tupleBytes > limits.maxStatementBytes) {
      flush();
      statements.push(...splitRow(table, literals, limits));
      continue;
    }
    if (size + tupleBytes > limits.maxStatementBytes) flush();
    pending.push(tuple);
    size += tupleBytes;
  }
  flush();
  return statements;
}

/** Deletes every copied table's rows, children first, so applying the copy twice gives the same data. */
export function clearStatements(tables: readonly TargetTable[]): string[] {
  return [...tables].reverse().map((table) => `DELETE FROM ${identifier(table.name)};`);
}

/** Splits statements into files of at most `maxBytes`, each starting with `prelude`. */
export function packFiles(statements: readonly string[], prelude: string, maxBytes: number): string[] {
  const files: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const statement of statements) {
    const bytes = byteLength(statement) + 1;
    if (current.length > 0 && size + bytes > maxBytes) {
      files.push(current);
      current = [];
      size = 0;
    }
    current.push(statement);
    size += bytes;
  }
  if (current.length > 0) files.push(current);
  return files.map((file) => `${prelude}\n${file.join("\n")}\n`);
}
