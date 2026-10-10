import { PrismaLibSql } from "@prisma/adapter-libsql";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  BatchConflictError,
  toBatchStep,
  touchedRows,
  type BatchBuilder,
  type BatchClient,
  type Database,
} from "../ports/database";

/** Where the database lives when DATABASE_URL is unset: a SQLite file next to the project. */
const DEFAULT_URL = "file:.data/matecrew.sqlite";

/** Prisma's code for a unique constraint violation. */
const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;
}

/**
 * libSQL has real transactions, so a batch is an interactive transaction: the
 * writes run in order, a guard compares the rows a write touched with what it
 * expects, and throwing rolls everything back.
 */
async function commitBatchOn(prisma: PrismaClient, build: BatchBuilder): Promise<number[]> {
  try {
    return await prisma.$transaction(async (tx) => {
      const steps = build(tx as unknown as BatchClient).map(toBatchStep);
      const rows: number[] = [];
      await steps.reduce(async (previous, step) => {
        await previous;
        const touched = touchedRows(await step.write);
        if (step.expect !== undefined && touched !== step.expect) throw new BatchConflictError("guard");
        rows.push(touched);
      }, Promise.resolve());
      return rows;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new BatchConflictError("unique", { cause: error });
    throw error;
  }
}

/**
 * The same SQLite schema as D1, in a file (or on a libSQL server) at `url`,
 * through libSQL. A Node process has no per-request I/O isolation, so one
 * client serves every request.
 */
export function sqliteDatabaseAt(url: string): Database {
  let prisma: PrismaClient | undefined;
  const client = () => {
    prisma ??= new PrismaClient({ adapter: new PrismaLibSql({ url }) });
    return prisma;
  };
  return {
    client,
    commitBatch: (build) => commitBatchOn(client(), build),
  };
}

const globalForDatabase = globalThis as unknown as { nodeDatabase?: Database };

/** The process's database, kept on `globalThis` so dev-server reloads do not open one per edit. */
function processDatabase(): Database {
  globalForDatabase.nodeDatabase ??= sqliteDatabaseAt(process.env.DATABASE_URL ?? DEFAULT_URL);
  return globalForDatabase.nodeDatabase;
}

/** DATABASE_URL (a `file:` path or a libSQL URL), or .data/matecrew.sqlite. */
export const sqliteDatabase: Database = {
  client: () => processDatabase().client(),
  commitBatch: (build) => processDatabase().commitBatch(build),
};
