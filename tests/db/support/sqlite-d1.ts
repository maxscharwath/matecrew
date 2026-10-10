import { Database, type SQLQueryBindings, type Statement } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve(import.meta.dir, "../../../migrations");

/** A fresh in-memory SQLite database with every migration in migrations/ applied, foreign keys on (as on D1). */
export function migratedSqlite(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

/** D1 hands blobs to its callers as arrays of byte values. */
function fromSqlite(value: unknown): unknown {
  return value instanceof Uint8Array ? Array.from(value) : value;
}

/** D1 takes blobs as arrays of byte values. */
function toSqlite(value: unknown): SQLQueryBindings {
  return (Array.isArray(value) ? new Uint8Array(value) : value) as SQLQueryBindings;
}

interface ShimResult {
  readonly success: true;
  readonly results: unknown[];
  readonly meta: { readonly changes: number };
}

class ShimStatement {
  private values: SQLQueryBindings[] = [];

  constructor(
    private readonly db: Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values.map(toSqlite);
    return this;
  }

  private statement(): Statement {
    return this.db.prepare(this.sql);
  }

  execute(): ShimResult {
    const statement = this.statement();
    if (statement.columnNames.length > 0) {
      const results = statement.all(...this.values);
      return { success: true, results, meta: { changes: 0 } };
    }
    const { changes } = statement.run(...this.values);
    return { success: true, results: [], meta: { changes } };
  }

  async run(): Promise<ShimResult> {
    return this.execute();
  }

  async raw(options?: { columnNames?: boolean }): Promise<unknown[][]> {
    const statement = this.statement();
    const rows = (statement.values(...this.values) as unknown[][]).map((row) => row.map(fromSqlite));
    return options?.columnNames ? [statement.columnNames, ...rows] : rows;
  }
}

/**
 * The part of a D1 binding Prisma and `commitBatch` use, over bun:sqlite.
 * `batch()` runs in one transaction and rolls back on the first error, as D1 does.
 */
export class SqliteD1 {
  constructor(readonly db: Database) {}

  prepare(sql: string): ShimStatement {
    return new ShimStatement(this.db, sql);
  }

  async batch(statements: ShimStatement[]): Promise<ShimResult[]> {
    return this.db.transaction(() => statements.map((statement) => statement.execute()))();
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  /** Typed as the Workers binding for code that expects one. */
  asBinding(): D1Database {
    return this as unknown as D1Database;
  }
}
