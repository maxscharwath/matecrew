import { BridgeRoute, type QueryRequest, type WireStatement } from "../cloudflare/bridge/protocol";
import type { D1Binding } from "../cloudflare/d1-database";
import type { Bridge } from "./bridge";

/** A value as D1 binds it; binary values travel as arrays of bytes, as D1 itself sends them. */
function wireValue(value: unknown): unknown {
  if (value === undefined) throw new TypeError("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
  if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return value;
}

export class RemoteD1Statement implements D1PreparedStatement {
  constructor(
    private readonly bridge: Bridge,
    private readonly sql: string,
    private readonly params: readonly unknown[],
  ) {}

  /** The statement as the bridge receives it. */
  get wire(): WireStatement {
    return { sql: this.sql, params: this.params };
  }

  bind(...values: unknown[]): RemoteD1Statement {
    return new RemoteD1Statement(this.bridge, this.sql, values.map(wireValue));
  }

  private query<T>(request: Pick<QueryRequest, "mode" | "columnNames">): Promise<T> {
    return this.bridge.call(BridgeRoute.query, { ...this.wire, ...request });
  }

  first<T = unknown>(colName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first<T>(colName?: string): Promise<T | null> {
    const { results } = await this.all<Record<string, unknown>>();
    const row = results.at(0);
    if (row === undefined) return null;
    if (colName === undefined) return row as T;
    if (!(colName in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${colName})`);
    return row[colName] as T;
  }

  run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.query({ mode: "run" });
  }

  all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.query({ mode: "all" });
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<[string[], ...T[]] | T[]> {
    return this.query({ mode: "raw", columnNames: options?.columnNames === true });
  }
}

/**
 * A D1 database reached through the platform bridge: the same interface as
 * the Worker's `DB` binding, so Prisma's D1 adapter and `commitBatch`
 * (src/platform/cloudflare/d1-database.ts) run on it unchanged. Each call is
 * one signed HTTPS request that the Worker runs on its binding; results and
 * errors come back as D1 gave them, so a batch still runs as one transaction
 * and a failed guard or unique key still aborts it.
 */
export class RemoteD1Database implements D1Binding {
  constructor(private readonly bridge: Bridge) {}

  prepare(sql: string): RemoteD1Statement {
    return new RemoteD1Statement(this.bridge, sql, []);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const wire = statements.map((statement) => {
      if (!(statement instanceof RemoteD1Statement)) throw new TypeError("A batch takes statements this database prepared");
      return statement.wire;
    });
    return this.bridge.call(BridgeRoute.batch, { statements: wire });
  }

  exec(sql: string): Promise<D1ExecResult> {
    return this.bridge.call(BridgeRoute.exec, { sql });
  }
}
