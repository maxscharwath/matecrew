import { readFileSync } from "node:fs";

/**
 * The D1 schema the copy writes into, read from the baseline migration rather
 * than restated here: the column lists, their SQLite types, the primary keys
 * and the foreign keys that decide the insert order.
 */

export type ColumnType = "TEXT" | "INTEGER" | "REAL" | "BOOLEAN" | "DATETIME" | "BLOB";

export interface TargetColumn {
  readonly name: string;
  readonly type: ColumnType;
  readonly notNull: boolean;
}

export interface TargetTable {
  readonly name: string;
  readonly columns: readonly TargetColumn[];
  readonly primaryKey: readonly string[];
  /** Tables this one points at (self-references excluded). */
  readonly references: readonly string[];
}

const TABLE_BLOCK = /CREATE TABLE "(\w+)" \(\n([\s\S]*?)\n\);/g;
const COLUMN_LINE = /^\s+"(\w+)" (TEXT|INTEGER|REAL|BOOLEAN|DATETIME|BLOB)\b(.*)$/;
const PRIMARY_KEY = /PRIMARY KEY \(([^)]*)\)/;
const REFERENCES = /REFERENCES "(\w+)"/g;

function names(list: string): string[] {
  return list.split(",").map((part) => part.trim().replaceAll('"', ""));
}

function parseTable(name: string, body: string): TargetTable {
  const lines = body.split("\n");
  const columns: TargetColumn[] = [];
  const inlineKey: string[] = [];
  for (const line of lines) {
    const match = COLUMN_LINE.exec(line);
    if (!match) continue;
    const [, column, type, rest] = match;
    columns.push({ name: column, type: type as ColumnType, notNull: rest.includes("NOT NULL") });
    if (rest.includes("PRIMARY KEY")) inlineKey.push(column);
  }
  const compositeKey = PRIMARY_KEY.exec(lines.find((line) => line.trimStart().startsWith("PRIMARY KEY")) ?? "");
  const references = [...body.matchAll(REFERENCES)].map((m) => m[1]).filter((table) => table !== name);
  return {
    name,
    columns,
    primaryKey: compositeKey ? names(compositeKey[1]) : inlineKey,
    references: [...new Set(references)],
  };
}

/** Every table of the DDL, parents before children, so inserts never break a foreign key. */
export function parseSchema(ddl: string): TargetTable[] {
  const tables = new Map([...ddl.matchAll(TABLE_BLOCK)].map((m) => [m[1], parseTable(m[1], m[2])]));
  const ordered: TargetTable[] = [];
  const visiting = new Set<string>();
  const visit = (name: string) => {
    if (ordered.some((t) => t.name === name)) return;
    if (visiting.has(name)) throw new Error(`Foreign keys form a cycle through ${name}`);
    const table = tables.get(name);
    if (!table) throw new Error(`Unknown referenced table ${name}`);
    visiting.add(name);
    table.references.forEach(visit);
    visiting.delete(name);
    ordered.push(table);
  };
  [...tables.keys()].sort((a, b) => a.localeCompare(b)).forEach(visit);
  return ordered;
}

/** The schema of migrations/0001_baseline.sql. */
export function baselineSchema(path = new URL("../../../migrations/0001_baseline.sql", import.meta.url)): TargetTable[] {
  return parseSchema(readFileSync(path, "utf8"));
}
