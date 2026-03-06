import { put, del, list, getDownloadUrl } from "@vercel/blob";
import type { StorageProvider } from "./types";

/** Resolve a storage key to the full Vercel Blob URL. */
async function resolveUrl(key: string): Promise<string | null> {
  const { blobs } = await list({ prefix: key, limit: 1 });
  return blobs[0]?.url ?? null;
}

export class VercelBlobProvider implements StorageProvider {
  async upload(opts: { key: string; body: Buffer; contentType: string }): Promise<void> {
    await put(opts.key, opts.body, {
      access: "private",
      contentType: opts.contentType,
      addRandomSuffix: false,
    });
  }

  async getSignedUrl(key: string): Promise<string> {
    const url = await resolveUrl(key);
    if (!url) throw new Error(`Blob not found: ${key}`);
    return getDownloadUrl(url);
  }

  async delete(key: string): Promise<void> {
    const url = await resolveUrl(key);
    if (url) await del(url);
  }

  async exists(key: string): Promise<boolean> {
    return (await resolveUrl(key)) !== null;
  }
}
