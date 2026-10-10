import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * The relational database, through Prisma.
 *
 * Business code never sees the driver: each adapter set picks one (D1 on
 * Cloudflare, libSQL on Node) and the schema stays in the subset every
 * provider shares, so switching databases changes no query
 * (src/platform/README.md).
 *
 * Atomic writes. `$transaction` is not on the client handed out: D1 has no
 * transactions, and Prisma's D1 adapter runs every `$transaction`, interactive
 * or array, as independent statements whose rollback does nothing. Writes that
 * must land together go through `commitBatch` instead:
 *
 * 1. read what the change depends on;
 * 2. compute every write in plain code;
 * 3. commit them in one batch: all of them, or none.
 *
 * When a write is only right if what was read still holds (a stock level, a
 * one-time token), give it `expect`: a conditional `updateMany` whose `where`
 * encodes the state that was read, and the number of rows it must touch. Any
 * other count, because someone changed the data in between, rolls the whole
 * batch back and throws `BatchConflictError`; the caller reads again or gives
 * up.
 */

/** The client business code queries with: everything but `$transaction`. */
export type Db = Omit<PrismaClient, "$transaction">;

/** The write methods a batch accepts: each compiles to plain statements that read nothing back. */
type BatchWriteMethod = "createMany" | "updateMany" | "deleteMany";

type ModelKey = Uncapitalize<Prisma.ModelName>;

/** What a batch is written with: the bulk writes of every model, and raw statements. */
export type BatchClient = {
  readonly [K in ModelKey]: Pick<PrismaClient[K], BatchWriteMethod>;
} & Pick<PrismaClient, "$executeRaw">;

/** A write, and optionally the exact number of rows it must touch for the batch to commit. */
export interface BatchStep {
  readonly write: Prisma.PrismaPromise<unknown>;
  /** Exact row count; any other rolls the batch back with `BatchConflictError`. */
  readonly expect?: number;
}

/**
 * Builds a batch's writes from the batch client. It must only describe writes:
 * they run when the batch commits, in the order given.
 */
export type BatchBuilder = (db: BatchClient) => readonly (Prisma.PrismaPromise<unknown> | BatchStep)[];

export interface Database {
  /** The Prisma client of the request, cron run or queue batch being served. */
  client(): Db;
  /** Commits the builder's writes atomically, in order; resolves to the rows each one touched. */
  commitBatch(build: BatchBuilder): Promise<number[]>;
}

/** Why a batch was rolled back: a guard saw other rows than expected, or a unique key was already taken. */
export type BatchConflictReason = "guard" | "unique";

/** The batch was rolled back because the data changed since it was read. Nothing was written. */
export class BatchConflictError extends Error {
  readonly reason: BatchConflictReason;

  constructor(reason: BatchConflictReason, options?: ErrorOptions) {
    super(`Batch rolled back: ${reason === "guard" ? "a guarded write saw changed data" : "a unique key is already taken"}`, options);
    this.name = "BatchConflictError";
    this.reason = reason;
  }
}

/** A write that must touch exactly `rows` rows, or the whole batch is rolled back. */
export function expectRows(write: Prisma.PrismaPromise<unknown>, rows: number): BatchStep {
  return { write, expect: rows };
}

/** Normalises a builder's entry to a step. */
export function toBatchStep(entry: Prisma.PrismaPromise<unknown> | BatchStep): BatchStep {
  return "write" in entry ? entry : { write: entry };
}

/** Rows touched, from what a bulk write (`{ count }`) or `$executeRaw` (a number) resolves to. */
export function touchedRows(result: unknown): number {
  if (typeof result === "number") return result;
  if (typeof result === "object" && result !== null && "count" in result && typeof result.count === "number") {
    return result.count;
  }
  return 0;
}
