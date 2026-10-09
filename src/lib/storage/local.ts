import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import type { DownloadResult, StorageProvider } from "./types";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

/**
 * Files on this machine's disk, under LOCAL_STORAGE_DIR (.data/storage by
 * default). For running the site on a copy of production
 * (scripts/clone-prod-db.sh) without touching the real bucket.
 */
export class LocalProvider implements StorageProvider {
  private root = resolve(process.env.LOCAL_STORAGE_DIR ?? ".data/storage");

  /** The key's path, refusing anything that would land outside the root. */
  private path(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error(`Invalid storage key: ${key}`);
    return path;
  }

  async upload(opts: { key: string; body: Buffer; contentType: string }): Promise<void> {
    const path = this.path(opts.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, opts.body);
  }

  async download(key: string): Promise<DownloadResult> {
    const body = await readFile(this.path(key));
    return { body, contentType: CONTENT_TYPES[extname(key).toLowerCase()] ?? "application/octet-stream" };
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return access(this.path(key)).then(
      () => true,
      () => false,
    );
  }
}
