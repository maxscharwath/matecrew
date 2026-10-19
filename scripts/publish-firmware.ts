/**
 * Publishes a firmware image for the terminals to install over the network:
 *
 *   bun scripts/publish-firmware.ts <image.bin> [version] [--cloudflare]
 *
 * The image is the application alone (`just release` makes it); the version
 * defaults to device/firmware/Cargo.toml's. Publishing a version again
 * replaces it.
 *
 * By default it uses the Node platform's database (DATABASE_URL) and storage
 * (LOCAL_STORAGE_DIR): a local site. With --cloudflare it publishes to the
 * production site on Cloudflare through wrangler and its login: the image to
 * the R2 bucket, the release to the D1 database, both in wrangler.jsonc
 * (`just publish-cloudflare`). Run it from the repository's root.
 */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const args = process.argv.slice(2);
const cloudflare = args.includes("--cloudflare");
const [file, given] = args.filter((arg) => arg !== "--cloudflare");
if (!file) throw new Error("Usage: bun scripts/publish-firmware.ts <image.bin> [version] [--cloudflare]");

const cargo = await readFile(new URL("../device/firmware/Cargo.toml", import.meta.url), "utf8");
const version = given ?? /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
if (!version) throw new Error("No version given and none in device/firmware/Cargo.toml.");
// It goes into a storage key, and into SQL for Cloudflare.
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${version} is not a version like 0.6.0.`);

const image = await readFile(file);
// An application image starts with the ESP32 image magic byte.
if (image[0] !== 0xe9) throw new Error(`${file} is not an ESP32 application image.`);
const sha256 = createHash("sha256").update(image).digest("hex");
const storageKey = `firmware/${version}-${sha256.slice(0, 12)}.bin`;

if (cloudflare) {
  await publishToCloudflare();
} else {
  const { platform } = await import("../src/platform");
  await platform.storage.put(storageKey, image, { contentType: "application/octet-stream" });
  await platform.database.client().firmwareRelease.upsert({
    where: { version },
    create: { version, sha256, size: image.length, storageKey },
    update: { sha256, size: image.length, storageKey, createdAt: new Date() },
  });
}
console.log(`Firmware ${version} published${cloudflare ? " on Cloudflare" : ""}: ${image.length} bytes, SHA-256 ${sha256}.`);

/** The image first: a release row never names an image that is not there yet. */
async function publishToCloudflare() {
  const run = promisify(execFile);
  // OWT's account, as scripts/cloudflare/copy-blobs.ts.
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "fb4a07dcf42e0226490dbaea4aa55bba" };
  const wrangler = async (...rest: string[]) => {
    const { stdout } = await run("bunx", ["wrangler", ...rest], { env, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  };
  await wrangler(
    "r2", "object", "put", `matecrew-files/${storageKey}`, "--file", file,
    "--content-type", "application/octet-stream", "--jurisdiction", "eu", "--remote",
  );
  // The date as Prisma's D1 adapter writes it, so "newest first" still sorts right.
  const now = new Date().toISOString().replace("Z", "+00:00");
  // Every value is checked above or made here: version digits, hex, a number, a UUID.
  const sql =
    `INSERT INTO "FirmwareRelease" ("id", "version", "sha256", "size", "storageKey", "createdAt") ` +
    `VALUES ('${randomUUID()}', '${version}', '${sha256}', ${image.length}, '${storageKey}', '${now}') ` +
    `ON CONFLICT("version") DO UPDATE SET "sha256" = excluded."sha256", "size" = excluded."size", ` +
    `"storageKey" = excluded."storageKey", "createdAt" = excluded."createdAt";`;
  await wrangler("d1", "execute", "matecrew", "--remote", "--command", sql);
}
