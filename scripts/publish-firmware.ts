/**
 * Publishes a firmware image for the terminals to install over the network:
 *
 *   bun scripts/publish-firmware.ts <image.bin> [version]
 *
 * The image is the application alone (`just release` makes it); the version
 * defaults to device/firmware/Cargo.toml's. Uses the Node platform's database
 * (DATABASE_URL) and storage (LOCAL_STORAGE_DIR): `just publish` runs it on
 * the local site. Publishing a version again replaces it.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { platform } from "../src/platform";

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

await platform.storage.put(storageKey, image, { contentType: "application/octet-stream" });
await platform.database.client().firmwareRelease.upsert({
  where: { version },
  create: { version, sha256, size: image.length, storageKey },
  update: { sha256, size: image.length, storageKey, createdAt: new Date() },
});
console.log(`Firmware ${version} published: ${image.length} bytes, SHA-256 ${sha256}.`);
