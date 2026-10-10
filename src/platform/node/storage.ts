import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import type { BlobInfo, BlobStore } from "../ports/storage";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".bin": "application/octet-stream",
};

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Files on this machine's disk, under LOCAL_STORAGE_DIR (`.data/storage` by
 * default), for `next dev` and tests. The content type is derived from the
 * key's extension, which every key the app builds carries.
 */
export function createFileBlobStore(root = resolve(process.env.LOCAL_STORAGE_DIR ?? ".data/storage")): BlobStore {
  /** The key's path, refusing anything that would land outside the root. */
  function pathOf(key: string): string {
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error(`Invalid storage key: ${key}`);
    return path;
  }

  function contentTypeOf(key: string): string {
    return CONTENT_TYPES[extname(key).toLowerCase()] ?? "application/octet-stream";
  }

  async function head(key: string): Promise<BlobInfo | null> {
    try {
      const { size } = await stat(pathOf(key));
      return { size, contentType: contentTypeOf(key) };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  return {
    async put(key, body) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    async get(key) {
      try {
        const bytes = await readFile(pathOf(key));
        return {
          body: new Blob([new Uint8Array(bytes)]).stream(),
          contentType: contentTypeOf(key),
          size: bytes.byteLength,
        };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    head,
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}
