import { BatchConflictError, platform, type BatchBuilder, type Db } from "@/platform";

export { BatchConflictError, expectRows } from "@/platform";

/**
 * The database client, for the request being served.
 *
 * The platform builds the client per request (D1 is a Worker binding), so this
 * module-level handle resolves it on each property access: call sites and
 * libraries holding it from module load (Better Auth) keep working unchanged.
 * It has no `$transaction`: atomic writes go through `commitBatch`.
 */
export const prisma: Db = new Proxy({} as Db, {
  get(_target, property) {
    const client = platform.database.client();
    const value: unknown = Reflect.get(client, property);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/**
 * Commits writes atomically: all of them, or none. Read first, compute the
 * writes, then commit them here; see `Database` in src/platform/ports/database.ts
 * for guards (`expectRows`) and `BatchConflictError`.
 */
export function commitBatch(build: BatchBuilder): Promise<number[]> {
  return platform.database.commitBatch(build);
}

/**
 * Splits ids for guarded writes (`expectRows` on `id: { in: ids }`): a guard
 * must stay one statement, and D1 binds at most ~100 values per statement,
 * so a long list becomes one guarded write per chunk.
 */
export function guardedChunks<T>(ids: readonly T[], size = 90): T[][] {
  return Array.from({ length: Math.ceil(ids.length / size) }, (_, i) => ids.slice(i * size, (i + 1) * size));
}

/**
 * An id for a row a batch creates, when a later write of the same batch must
 * point at it (`createMany` returns no rows). Ids are opaque strings, so these
 * live alongside the cuids Prisma generates.
 */
export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Runs read-compute-commit again when its batch is rolled back because the
 * data changed in between, up to `attempts` times in all; the last conflict
 * is rethrown.
 */
export async function retryOnConflict<T>(attempt: () => Promise<T>, attempts = 3): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof BatchConflictError) || attempts <= 1) throw error;
    return retryOnConflict(attempt, attempts - 1);
  }
}
