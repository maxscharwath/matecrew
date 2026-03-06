import { put, del, list, getDownloadUrl } from "@vercel/blob";
import type { DownloadResult, StorageProvider } from "./types";

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

  async download(key: string): Promise<DownloadResult> {
    const url = await resolveUrl(key);
    if (!url) throw new Error(`Blob not found: ${key}`);
    const downloadUrl = getDownloadUrl(url);
    const res = await fetch(downloadUrl);
    if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
    return {
      body: res.body,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async delete(key: string): Promise<void> {
    const url = await resolveUrl(key);
    if (url) await del(url);
  }

  async exists(key: string): Promise<boolean> {
    return (await resolveUrl(key)) !== null;
  }
}
