import { BatchConflictError, platform, type BatchBuilder, type BatchClient, type Db } from "@/platform";
import { wrote } from "@/lib/device/push";

export { BatchConflictError, expectRows } from "@/platform";

/** The model methods that write; after one resolves, `wrote` hears of its model. */
const WRITES = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

/** The models a raw statement writes ("Stock" → "stock"). */
function rawTables(sql: string): string[] {
  return [...sql.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"(\w+)"/gi)].map(
    ([, table]) => table[0].toLowerCase() + table.slice(1),
  );
}

/** A model delegate whose writes are reported once they succeed. */
function reportingWrites(model: string, delegate: object): object {
  return new Proxy(delegate, {
    get(target, method) {
      const value: unknown = Reflect.get(target, method);
      if (typeof value !== "function") return value;
      if (typeof method !== "string" || !WRITES.has(method)) return value.bind(target);
      return (...args: unknown[]) =>
        Promise.resolve(value.apply(target, args)).then((result: unknown) => {
          wrote(model);
          return result;
        });
    },
  });
}

/**
 * The database client, for the request being served.
 *
 * The platform builds the client per request (D1 is a Worker binding), so this
 * module-level handle resolves it on each property access: call sites and
 * libraries holding it from module load (Better Auth) keep working unchanged.
 * It has no `$transaction`: atomic writes go through `commitBatch`.
 *
 * Writes are reported to `wrote` (src/lib/device/push.ts): the terminals sync
 * when what they show changes, whoever changed it.
 */
export const prisma: Db = new Proxy({} as Db, {
  get(_target, property) {
    const client = platform.database.client();
    const value: unknown = Reflect.get(client, property);
    if (property === "$executeRaw" && typeof value === "function") {
      return (strings: TemplateStringsArray, ...values: unknown[]) =>
        Promise.resolve(value.call(client, strings, ...values)).then((rows: unknown) => {
          rawTables(strings.join("?")).forEach(wrote);
          return rows;
        });
    }
    if (typeof value === "function") return value.bind(client);
    // Model delegates: `prisma.stock`, not `$`-methods nor Prisma's `_`-internals.
    if (typeof property === "string" && /^[a-z]/.test(property) && typeof value === "object" && value !== null) {
      return reportingWrites(property, value);
    }
    return value;
  },
});

/** The batch client, noting the models the batch writes. */
function noting(db: BatchClient, models: Set<string>): BatchClient {
  return new Proxy(db, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (property === "$executeRaw" && typeof value === "function") {
        return (strings: TemplateStringsArray, ...values: unknown[]) => {
          rawTables(strings.join("?")).forEach((model) => models.add(model));
          return value.call(target, strings, ...values);
        };
      }
      if (typeof property === "string" && /^[a-z]/.test(property)) models.add(property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Commits writes atomically: all of them, or none. Read first, compute the
 * writes, then commit them here; see `Database` in src/platform/ports/database.ts
 * for guards (`expectRows`) and `BatchConflictError`.
 */
export async function commitBatch(build: BatchBuilder): Promise<number[]> {
  const models = new Set<string>();
  const rows = await platform.database.commitBatch((db) => build(noting(db, models)));
  models.forEach(wrote);
  return rows;
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
