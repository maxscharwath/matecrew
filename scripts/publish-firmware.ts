/**
 * Publishes a firmware image for the terminals to install over the network:
 *
 *   bun scripts/publish-firmware.ts <image.bin> [version]
 *
 * The image is the application alone (`just release` makes it); the version
 * defaults to device/firmware/Cargo.toml's. Uses the current environment's
 * DATABASE_URL and storage provider: `just publish` runs it on the local
 * site with STORAGE_PROVIDER=local. Publishing a version again replaces it.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { uploadFile } from "../src/lib/storage";

const [file, given] = process.argv.slice(2);
if (!file) throw new Error("Usage: bun scripts/publish-firmware.ts <image.bin> [version]");

const cargo = await readFile(new URL("../device/firmware/Cargo.toml", import.meta.url), "utf8");
const version = given ?? /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
if (!version) throw new Error("No version given and none in device/firmware/Cargo.toml.");

const image = await readFile(file);
// An application image starts with the ESP32 image magic byte.
if (image[0] !== 0xe9) throw new Error(`${file} is not an ESP32 application image.`);
const sha256 = createHash("sha256").update(image).digest("hex");
const storageKey = `firmware/${version}-${sha256.slice(0, 12)}.bin`;

await uploadFile({ key: storageKey, body: image, contentType: "application/octet-stream" });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
await prisma.firmwareRelease.upsert({
  where: { version },
  create: { version, sha256, size: image.length, storageKey },
  update: { sha256, size: image.length, storageKey, createdAt: new Date() },
});
await prisma.$disconnect();
console.log(`Firmware ${version} published: ${image.length} bytes, SHA-256 ${sha256}.`);
