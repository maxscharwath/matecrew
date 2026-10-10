/**
 * Copies every Vercel Blob object to Cloudflare R2 under the same key, for the
 * move to Cloudflare. Run by the user, with production credentials they
 * provide in the environment; it only reads from Vercel Blob.
 *
 *   bun scripts/cloudflare/copy-blobs.ts [--dry-run] [--to-dir <dir>]
 *
 * Environment:
 *   BLOB_READ_WRITE_TOKEN   the Vercel Blob store's token (list + get)
 *   R2_ACCOUNT_ID           the Cloudflare account (OWT)
 *   R2_ACCESS_KEY_ID        an R2 API token with Object Read & Write
 *   R2_SECRET_ACCESS_KEY    on the bucket below
 *   R2_BUCKET_NAME          optional, defaults to matecrew-files
 *   R2_ENDPOINT             optional, defaults to the EU jurisdiction's S3
 *                           endpoint, https://<account>.eu.r2.cloudflarestorage.com
 *
 * Resumable: an object already at the destination with the same size is
 * skipped, so a run that stopped can simply be started again.
 * --dry-run reports what would be copied and writes nothing.
 * --to-dir writes into a local directory instead of R2 (no R2 variables
 * needed), e.g. .data/storage for the Node platform's local storage.
 *
 * Vercel counts one advanced operation per 1,000 listed blobs and one simple
 * operation per blob read; a re-run reads only the blobs not copied yet.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { get, list, type ListBlobResultBlob } from "@vercel/blob";

const CONCURRENCY = 8;
const LIST_PAGE = 1000;

interface Destination {
  readonly label: string;
  /** Size in bytes of the copy already there, or null when there is none. */
  sizeOf(key: string): Promise<number | null>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function r2Destination(): Destination {
  const bucket = process.env.R2_BUCKET_NAME ?? "matecrew-files";
  const client = new S3Client({
    region: "auto",
    // The bucket lives in the EU jurisdiction, which has its own endpoint.
    endpoint: process.env.R2_ENDPOINT ?? `https://${required("R2_ACCOUNT_ID")}.eu.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
  });
  return {
    label: `R2 bucket ${bucket}`,
    async sizeOf(key) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return head.ContentLength ?? 0;
      } catch (error) {
        if (error instanceof Error && error.name === "NotFound") return null;
        throw error;
      }
    },
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
  };
}

function directoryDestination(dir: string): Destination {
  const root = resolve(dir);
  const pathOf = (key: string) => {
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error(`Invalid key: ${key}`);
    return path;
  };
  return {
    label: root,
    async sizeOf(key) {
      try {
        return (await stat(pathOf(key))).size;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
        throw error;
      }
    },
    async put(key, body) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
  };
}

/** Every blob in the store, one page after the other. */
async function listAll(cursor?: string, found: ListBlobResultBlob[] = []): Promise<ListBlobResultBlob[]> {
  const page = await list({ cursor, limit: LIST_PAGE });
  const all = [...found, ...page.blobs];
  return page.hasMore && page.cursor ? listAll(page.cursor, all) : all;
}

type Outcome = "copied" | "skipped" | "planned";

async function copyOne(blob: ListBlobResultBlob, destination: Destination, dryRun: boolean): Promise<Outcome> {
  if ((await destination.sizeOf(blob.pathname)) === blob.size) return "skipped";
  if (dryRun) return "planned";
  const file = await get(blob.pathname, { access: "private" });
  if (file?.statusCode !== 200) throw new Error(`Cannot read ${blob.pathname} from Vercel Blob`);
  const body = new Uint8Array(await new Response(file.stream).arrayBuffer());
  await destination.put(blob.pathname, body, file.blob.contentType);
  return "copied";
}

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "to-dir": { type: "string" },
  },
});
const dryRun = values["dry-run"];
required("BLOB_READ_WRITE_TOKEN");
const destination = values["to-dir"] ? directoryDestination(values["to-dir"]) : r2Destination();

const blobs = await listAll();
console.log(`${blobs.length} blobs in Vercel Blob, destination ${destination.label}${dryRun ? " (dry run)" : ""}.`);

const counts: Record<Outcome, number> = { copied: 0, skipped: 0, planned: 0 };
const failures: string[] = [];
const pending = [...blobs];

/** One worker: takes the next blob until none is left. */
async function drain(): Promise<void> {
  const blob = pending.shift();
  if (!blob) return;
  try {
    const outcome = await copyOne(blob, destination, dryRun);
    counts[outcome] += 1;
    if (outcome !== "skipped") console.log(`${outcome === "planned" ? "would copy" : "copied"} ${blob.pathname}`);
  } catch (error) {
    failures.push(blob.pathname);
    console.error(`failed ${blob.pathname}:`, error instanceof Error ? error.message : error);
  }
  return drain();
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => drain()));

const done = dryRun ? `${counts.planned} to copy` : `${counts.copied} copied`;
console.log(`${done}, ${counts.skipped} already there, ${failures.length} failed.`);
if (failures.length > 0) {
  console.error("Run again to retry the failed ones.");
  process.exitCode = 1;
}
