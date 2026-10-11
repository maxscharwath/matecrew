# Platform layer

Business code (`src/app`, `src/lib`, `src/jobs`) never talks to a cloud
provider. It imports one object:

```ts
import { platform } from "@/platform";

await platform.storage.put(key, bytes, { contentType: "image/webp" });
await platform.jobs.enqueue({ name: "period-statements", payload: { periodId } });
platform.runInBackground(checkAndAlertLowStock(officeId, itemId), "low-stock alert");
const origin = platform.env.baseUrl();
```

`platform` implements the **ports** (`ports/`, one interface per concern).
Each **adapter set** (`cloudflare/`, `node/`, `vercel/`) provides all of them.
The build compiles in exactly one adapter set.

## Ports

| Port | File | Contract |
| --- | --- | --- |
| `storage: BlobStore` | `ports/storage.ts` | Immutable files by key: `put`, `get` (a stream), `head`, `delete`. Keys come from `src/lib/storage.ts` and are kept unchanged. |
| `jobs: JobQueue` | `ports/jobs.ts` | `enqueue(job)` hands a typed JSON job (`JobPayloads`) to a queue. Delivery is at least once, so handlers are idempotent. |
| `runInBackground` | `ports/background.ts` | Keeps the runtime alive until a promise settles after the response is sent, and logs a failure under a label. |
| `env: AppEnv` | `ports/env.ts` | Typed configuration and secrets (`EnvName`) plus `baseUrl()`, the public origin and OAuth issuer. |
| `database: Database` | `ports/database.ts` | The Prisma client and `commitBatch` for atomic writes (D1 has no transactions). |
| `images: ImageProcessor` | `ports/images.ts` | Item photos (WebP) and the terminal's grey levels. |
| `pdf: PdfRenderer` | `ports/pdf.ts` | React-PDF documents to bytes. |
| `relay: TerminalRelay` | `ports/realtime.ts` | The terminals' live channel (realtime/): console sockets, commands, "what you show changed", presence, last screen. `noRelay` where there is none: terminals and consoles poll the site. |

### Jobs and schedules

The business side of background work lives in `src/jobs`, not in the platform:

- `src/jobs/schedules.ts` maps each scheduled task's name to a UTC cron expression.
- `src/jobs/index.ts` holds the job handlers (`runJob`, `runQueuedJob`, which
  checks the message first) and the scheduled tasks (`runScheduledTasks(cron, now)`).

A platform entry only receives events and calls those two functions. Cloudflare's
entry is `cloudflare/worker.ts`, with `scheduled` and `queue` handlers. A platform
entry never decides what a job does.

## Adapter sets

| Port | `cloudflare/` (Workers, OpenNext) | `node/` (`next dev`, tests, containers) | `vercel/` (Vercel, on the Cloudflare deployment's data) |
| --- | --- | --- | --- |
| storage | R2 binding `FILES` | Files under `LOCAL_STORAGE_DIR` (`.data/storage`) | That R2 bucket, through the platform bridge |
| jobs | Queue binding `JOBS`, consumed by `worker.ts` with retries and a dead-letter queue | Runs the job in-process at once, without waiting for it | That Queue, through the bridge. No schedules: only Cloudflare's Cron Triggers fire |
| runInBackground | `ctx.waitUntil` | Tracked promise (`settleBackground()` for tests) | `after()` from `next/server` |
| env | `process.env`, filled by `nodejs_compat` from the Worker's vars and secrets | `process.env` (`.env.local`) | `process.env` (the Vercel project's variables) |
| database | D1 binding `DB`, atomic batches through `D1Database.batch()` | SQLite through libSQL (`DATABASE_URL`, default `.data/matecrew.sqlite`), batches as transactions | That D1 database, through the bridge, with the Cloudflare adapter's code |
| images | Images binding `IMAGES` plus a small PNG/grey codec | sharp | sharp (`node/images.ts`) |
| pdf | React-PDF with yoga loaded for workerd | React-PDF | React-PDF (`node/pdf.ts`) |
| relay | The relay Worker's Durable Objects (binding `TERMINALS` with `script_name`) over RPC, at `REALTIME_URL` | None (`noRelay`): polling | None (`noRelay`): polling |

The Cloudflare adapters read their bindings per call through
`getCloudflareContext()`. Never call it at module top level. `worker.ts` sets the
context up for cron runs and queue batches as well as for requests.

## Build-time selection

`@/platform/active` is an import alias that resolves to the adapter set's
`index.ts`:

- **Next** (`next.config.ts`): `PLATFORM=node|cloudflare|vercel` sets
  `turbopack.resolveAlias`, plus the webpack alias. Unset, it is `vercel` when
  `VERCEL` is set (Vercel's build sets it), else `node`.
  - `bun run dev` and `bun run build` give Node.
  - Vercel's build gives Vercel, with no project setting.
  - `bun run dev:cf`, `bun run preview` and `bun run deploy` give Cloudflare. With
    Cloudflare, `next dev` also serves the local bindings through
    `initOpenNextCloudflareForDev()`.
- **Worker entry** (`wrangler.jsonc` `alias`): wrangler bundles `worker.ts`
  outside Next and resolves the alias to `cloudflare/`.
- **TypeScript and `bun test`** (`tsconfig.json` `paths`): the alias points to
  `node/`. Every adapter set exports the same `Platform` type, so type-checking
  against one checks the callers for all of them.

Only `src/platform/index.ts` imports `@/platform/active`. Business code imports
`@/platform`, and only adapters import their SDKs (`@opennextjs/cloudflare`,
`sharp`, `node:fs`). The Vercel set reuses `cloudflare/d1-database.ts` and the
bridge protocol, neither of which touches a binding or `getCloudflareContext`.

## Platform bridge

During the move to Cloudflare, the same code also runs on Vercel, on the
Cloudflare deployment's data: one D1 database, one R2 bucket, one Queue. Vercel
reaches them through a bridge in the Worker, not through D1's REST API, which
shares the account's API rate limit (about 1,200 requests per 5 minutes) and
which Cloudflare advises against in production. Bindings have no such limit.

- `cloudflare/bridge/handler.ts`: served by `worker.ts` before OpenNext, under
  `/__platform/`. Routes: `d1/query` (one statement, `all`, `run` or `raw`),
  `d1/batch` (`D1Database.batch()`, one transaction), `d1/exec`, `jobs` (onto
  `JOBS`), and `storage/<key>` (GET and HEAD streamed from R2, PUT streamed to
  it, DELETE).
- `cloudflare/bridge/protocol.ts`: routes, headers and signing, Web Crypto only.
- `vercel/bridge.ts` and `vercel/remote-d1.ts`: the client. `RemoteD1Database`
  has the D1 binding's interface, so the Vercel set runs `connectD1` (Prisma's
  D1 adapter and `commitBatch`) on it unchanged. D1's errors come back with
  their message, so a failed guard or a taken unique key aborts the batch in
  the Worker and gives the same `BatchConflictError` on Vercel.

Security:

- Every request carries an HMAC-SHA256, keyed with `PLATFORM_BRIDGE_SECRET`, of
  its method, its path with query (a file's content type travels there), a
  timestamp and the SHA-256 of its body. The bridge checks it with
  `crypto.subtle.verify`, a constant-time comparison, and refuses a timestamp
  more than 60 s away from its clock. The body is then checked against the
  signed hash: by the bridge for JSON, and by R2 itself (`sha256` on `put`) for
  a file, which is streamed and not stored on a mismatch.
- A request the bridge does not authenticate goes on to OpenNext, which
  answers the app's own 404, so the prefix does not advertise itself. Every
  answer from the bridge carries `x-bridge`. The client treats an answer
  without it as a refusal, never as a missing file.
- The secret gives full read and write access to the database and the files:
  it is a database credential. It is a Worker secret and a Vercel environment
  variable of at least 32 characters (`openssl rand -base64 48`). When it is
  unset or shorter, the bridge is off.
- Nothing logs SQL values or bodies. The client sends `cache: "no-store"` and
  `redirect: "error"`.
- A captured request could be replayed within its 60 s. Capturing one means
  reading the HTTPS traffic first.

Each statement is one HTTPS round trip from Vercel to the Worker: about 1.5 ms
locally, plus the network between Vercel's `fra1` region and Cloudflare. Clients
that query a lot, such as the terminal's long poll, use the Cloudflare URL.

When Vercel is retired, remove `vercel/`, `cloudflare/bridge/`, the bridge
lines in `worker.ts`, `"vercel"` in `next.config.ts`, `vercel.json` and the
secret.

## Database

`platform.database` hands out a Prisma client (`client()`) and `commitBatch`.
Business code imports both through `@/lib/prisma` (`prisma`, `commitBatch`,
`expectRows`, `retryOnConflict`, `newId`, `BatchConflictError`) and never sees
the driver.

### Atomic writes: `commitBatch`

D1 has no transactions, and Prisma's D1 adapter runs every `$transaction`,
interactive or array, as separate statements that cannot be rolled back.
`$transaction` is therefore left off the client type. Writes that must land
together follow one pattern:

1. Read what the change depends on.
2. Compute every write in plain code.
3. Commit them in one `commitBatch((db) => [...])`: all of them, or none.

The batch client only offers `createMany`, `updateMany`, `deleteMany` and
`$executeRaw`, the writes that read nothing back. A row that a later write
points at gets its id up front from `newId()`.

When a write is only right while what was read still holds, guard it with
`expectRows(db.x.updateMany({ where: <the state read>, data }), n)`. If the
row count is not `n`, because the data changed in between, the whole batch
is rolled back and `BatchConflictError` is thrown. A unique key that is taken
by then throws it too, with `reason: "unique"`. Wrap read-compute-commit in
`retryOnConflict` to start again from fresh data, or map the conflict to a
message. Shared guards: `stockAtLeast` and `stockUnchanged` in `src/lib/stock.ts`,
and `officeKeepsAnAdmin` in `src/lib/membership-roles.ts`.

Each adapter implements the same contract:

- **Cloudflare** (`cloudflare/d1-database.ts`): the writes are compiled to SQL
  without being run, by a second Prisma client whose D1 binding only records
  statements. They are then sent with `D1Database.batch()`, which runs them
  as one SQLite transaction. A guard is a statement after its write,
  `SELECT json(CASE WHEN changes() = ? THEN ... ELSE <invalid JSON> END)`. On a
  mismatch, it raises an error and aborts the batch.
- **Node** (`node/database.ts`): libSQL has transactions, so a batch is an
  interactive `$transaction`. The writes run in order and a guard compares the
  row count in code. Throwing rolls everything back.
- **Vercel** (`vercel/database.ts`): the Cloudflare implementation on a
  `RemoteD1Database`, so the batch runs in the Worker as above.
- **Postgres or SQL Server** (a future adapter): the same as Node, an
  interactive `$transaction` with the count check. An array `$transaction([...])`
  is atomic there too, but it cannot stop part-way on a guard.

Tests: `tests/db/commit-batch.test.ts` runs the same cases against both
adapters, including a guard failure that must leave no write behind.
`tests/platform/bridge.integration.test.ts` runs the guard and unique cases
through the bridge, served by `wrangler dev` on a local D1.

### Schema and migrations

`prisma/schema.prisma` stays in the subset that every relational provider
shares:

- roles are a table (`MembershipRole`), not a scalar list;
- money is integer cents (`…Cents`, see `src/lib/money.ts`);
- calendar days are `DateTime` at UTC midnight (`src/lib/date.ts`);
- `Device.syncTimes` is a comma-separated string;
- there are no `@db.*` native types and no `mode: "insensitive"`: name
  lookups compare in code (`src/lib/mcp/name-match.ts`).

Raw SQL (stock upserts, frame upserts, guards) quotes identifiers with double
quotes and uses `INSERT ... ON CONFLICT ... DO UPDATE`. SQLite and Postgres
both run it.

Migrations are plain SQL files in `migrations/`, `0001_baseline.sql` first:

- D1: `wrangler d1 migrations apply matecrew --local|--remote` (`bun db:migrate:local`).
- The Node SQLite file: `bun db:migrate:sqlite`.
- A new one: edit the schema, then `bun db:migration <name>`. It replays
  `migrations/` into a scratch SQLite file and lets Prisma diff it against the
  schema.

### Switching the database provider (Azure Database for PostgreSQL)

1. In `prisma/schema.prisma`, set `provider = "postgresql"` in the datasource.
   In the generator, set `runtime = "nodejs"` (keep `moduleFormat`). Run
   `bunx prisma generate`. No model changes.
2. Start a Postgres migration history next to the D1 one, for example
   `migrations-postgres/0001_baseline.sql`, from
   `bunx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`.
   Apply it with `prisma migrate deploy` from CI (configure `migrations.path`
   and the datasource URL in `prisma.config.ts`), or with `psql` on a fresh
   database.
3. Add the driver with `bun add @prisma/adapter-pg`. In the platform's
   database adapter, build the client with
   `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`, the
   connection string coming from Key Vault through `platform.env`.
   `commitBatch` is the interactive `$transaction` of `node/database.ts`, with
   `P2002` mapped to `BatchConflictError("unique")`. Copy that function as it is.
4. Copy the data: export each table and load it in foreign-key order, as
   `scripts/cloudflare/copy-db.ts` does in the other direction. Cents, days
   and roles already have the right shape.
5. Run `bun test`. `tests/db/commit-batch.test.ts` takes one more entry in
   `ADAPTERS`, a function returning the Postgres `Database`, so the guards are
   checked on Postgres too.

Business code, queries and tests stay as they are.

## Adding a platform: Azure

1. Create `src/platform/azure/index.ts` exporting `platform: Platform`, and add
   `"azure"` to `PLATFORMS` in `next.config.ts`.
2. Map each port:
   - **storage**: Azure Blob Storage (`@azure/storage-blob`, a container per
     environment, key = blob name, content type in `blobHTTPHeaders`). Use a
     managed identity instead of a connection string.
   - **jobs**:
     - Azure Service Bus queue (or a Storage Queue for low volume). `enqueue`
       sends the JSON job.
     - An Azure Functions app with a Service Bus trigger calls `runQueuedJob(message)`.
     - A thrown error makes Service Bus redeliver, and the queue's dead-letter
       queue takes the job after the maximum number of deliveries.
   - **schedules**:
     - One Azure Functions timer trigger per entry in `src/jobs/schedules.ts`
       (NCRONTAB has a seconds field: `0 */5 * * * *`), each calling
       `runScheduledTasks(cron, new Date())`.
     - Set `WEBSITE_TIME_ZONE` to UTC or leave it unset: the expressions are in UTC.
   - **runInBackground**: App Service and Container Apps run a long-lived
     Node process, so `node/background.ts` works as it is.
   - **env**: App Settings, with secrets as Key Vault references. They arrive
     in `process.env`, so `shared/process-env.ts` works as it is.
   - **database**: Azure Database for PostgreSQL through Prisma's `pg`
     adapter. See "Switching the database provider" above. Queries stay the same.
   - **images**: sharp, as on Node (`node/images.ts`).
   - **pdf**: React-PDF, as on Node (`node/pdf.ts`).
3. Deploy the Next app as a standalone Node server (`output: "standalone"`)
   on App Service or Container Apps, built with `PLATFORM=azure`. Deploy the
   Functions app from the same repository, importing `src/jobs`.

On Azure App Service most ports are the Node adapters. Only storage, jobs and
the database change.
