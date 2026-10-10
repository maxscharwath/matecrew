import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "@/generated/prisma/client";
import {
  BatchConflictError,
  toBatchStep,
  type BatchBuilder,
  type BatchClient,
  type Db,
} from "../ports/database";

/**
 * Prisma on one D1 database, with atomic batches.
 *
 * D1's only atomic primitive is `D1Database.batch()`: the statements run as
 * one SQLite transaction and the first failing one rolls them all back. Prisma
 * cannot use it (its D1 adapter runs `$transaction` as loose statements), so
 * `commitBatch` compiles the Prisma writes to SQL without running them, then
 * sends the statements through `batch()` itself.
 *
 * Compiling: a second client runs the writes against a recording stand-in for
 * the binding, which keeps every bound statement instead of executing it. The
 * real adapter does the binding, so values are encoded exactly as on a normal
 * query. A write that would read (a nested write, an upsert) cannot be batched
 * and fails loudly here; `BatchClient` only offers the bulk writes for that
 * reason.
 *
 * Guards: after a write with `expect`, the batch runs
 * `SELECT json(CASE WHEN changes() = ? THEN 'true' ELSE ... END)`, which raises
 * "malformed JSON" when the write touched any other number of rows. The error
 * aborts the batch, so nothing before or after it is kept.
 */

/** Raises "malformed JSON", and so aborts the batch, unless the previous statement changed exactly ?1 rows. */
const GUARD_SQL = "SELECT json(CASE WHEN changes() = ?1 THEN 'true' ELSE 'batch guard failed' END)";
const GUARD_FAILED = "malformed JSON";
const UNIQUE_FAILED = "UNIQUE constraint failed";

interface CompiledStep {
  readonly statements: readonly D1PreparedStatement[];
  readonly expect: number | undefined;
}

/** Stands in for the D1 binding while writes are compiled: keeps each bound statement, executes nothing. */
class StatementRecorder {
  private recorded: D1PreparedStatement[] = [];

  constructor(private readonly db: D1Binding) {}

  /** The subset of `D1Database` Prisma's adapter calls. */
  readonly binding = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => {
        const statement = this.db.prepare(sql).bind(...values);
        return {
          run: async () => {
            this.recorded.push(statement);
            return { meta: { changes: 0 } };
          },
          raw: async (): Promise<unknown[][]> => {
            throw new Error(`A batch can only hold writes that read nothing back, got: ${sql}`);
          },
        };
      },
    }),
  };

  /** The statements recorded since the last call. */
  take(): D1PreparedStatement[] {
    const statements = this.recorded;
    this.recorded = [];
    return statements;
  }
}

/** Runs tasks one after another, so two batches never record into the same buffer. */
function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

function conflictFrom(error: unknown): BatchConflictError | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(GUARD_FAILED)) return new BatchConflictError("guard", { cause: error });
  if (message.includes(UNIQUE_FAILED)) return new BatchConflictError("unique", { cause: error });
  return null;
}

/**
 * What Prisma's D1 adapter and `commitBatch` use of a D1 database: the
 * Worker's `DB` binding, or the bridge client of src/platform/vercel.
 */
export type D1Binding = Pick<D1Database, "prepare" | "batch" | "exec">;

export interface D1Connection {
  readonly client: Db;
  commitBatch(build: BatchBuilder): Promise<number[]>;
}

/**
 * The adapter for the compiling client. Bulk writes open a transaction that
 * the recorder never executes, so the adapter's notice that D1 has none
 * (printed once per adapter, so once per request) is noise there.
 */
function recordingAdapter(recorder: StatementRecorder): PrismaD1 {
  // PrismaD1 only calls prepare/bind/run/raw on its binding; the recorder provides exactly those.
  const adapter = new PrismaD1(recorder.binding as unknown as D1Database);
  const connect = adapter.connect.bind(adapter);
  adapter.connect = async () => {
    const connection = await connect();
    (connection as { alreadyWarned?: Set<string> }).alreadyWarned?.add("D1 Transaction");
    return connection;
  };
  return adapter;
}

export function connectD1(db: D1Binding): D1Connection {
  const recorder = new StatementRecorder(db);
  // Built on the first batch: most requests only read.
  let compiler: PrismaClient | undefined;
  const exclusive = serialQueue();

  function compile(build: BatchBuilder): Promise<CompiledStep[]> {
    return exclusive(async () => {
      recorder.take();
      compiler ??= new PrismaClient({ adapter: recordingAdapter(recorder) });
      const steps = build(compiler as unknown as BatchClient).map(toBatchStep);
      const compiled: CompiledStep[] = [];
      // One write at a time, in order: each one's statements are taken before the next runs.
      await steps.reduce(async (previous, step) => {
        await previous;
        await step.write;
        const statements = recorder.take();
        if (step.expect !== undefined && statements.length !== 1) {
          throw new Error(`A guarded write must compile to one statement, got ${statements.length}`);
        }
        compiled.push({ statements, expect: step.expect });
      }, Promise.resolve());
      return compiled;
    });
  }

  async function commitBatch(build: BatchBuilder): Promise<number[]> {
    const compiled = await compile(build);
    const statements = compiled.flatMap((step) =>
      step.expect === undefined ? step.statements : [...step.statements, db.prepare(GUARD_SQL).bind(step.expect)],
    );
    if (statements.length === 0) return compiled.map(() => 0);

    let results: D1Result[];
    try {
      results = await db.batch(statements);
    } catch (error) {
      throw conflictFrom(error) ?? error;
    }

    let next = 0;
    return compiled.map((step) => {
      const rows = step.statements.reduce((sum, _statement, index) => sum + (results[next + index].meta.changes ?? 0), 0);
      next += step.statements.length + (step.expect === undefined ? 0 : 1);
      return rows;
    });
  }

  return {
    // PrismaD1 only calls prepare (then bind/run/raw) and exec on its binding.
    client: new PrismaClient({ adapter: new PrismaD1(db as D1Database) }),
    commitBatch,
  };
}
