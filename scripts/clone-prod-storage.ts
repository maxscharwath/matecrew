/**
 * Copies production's stored files (avatars, item pictures, invoices...) into
 * LOCAL_STORAGE_DIR (.data/storage), where STORAGE_PROVIDER=local reads them.
 * Run by scripts/clone-prod-db.sh with production's environment. It only
 * reads: on Vercel Blob, one list() per 1,000 files and one get() per file.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { get, list } from "@vercel/blob";

const root = resolve(process.env.LOCAL_STORAGE_DIR ?? ".data/storage");

async function save(key: string, body: Uint8Array) {
  const path = resolve(root, key);
  if (!path.startsWith(root + sep)) throw new Error(`Invalid key: ${key}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

async function* r2Files() {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
  const Bucket = process.env.R2_BUCKET_NAME ?? "matecrew-invoices";
  let ContinuationToken: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket, ContinuationToken }));
    for (const { Key } of page.Contents ?? []) {
      if (!Key) continue;
      const object = await client.send(new GetObjectCommand({ Bucket, Key }));
      yield { key: Key, body: await object.Body!.transformToByteArray() };
    }
    ContinuationToken = page.NextContinuationToken;
  } while (ContinuationToken);
}

async function* blobFiles() {
  let cursor: string | undefined;
  do {
    const page = await list({ cursor, limit: 1000 });
    for (const blob of page.blobs) {
      const file = await get(blob.pathname, { access: "private" });
      if (!file) continue;
      yield { key: blob.pathname, body: new Uint8Array(await new Response(file.stream).arrayBuffer()) };
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}

const provider = process.env.STORAGE_PROVIDER ?? "vercel-blob";
let count = 0;
for await (const { key, body } of provider === "r2" ? r2Files() : blobFiles()) {
  await save(key, body);
  count += 1;
}
console.log(`${count} files from ${provider} copied to ${root}.`);
