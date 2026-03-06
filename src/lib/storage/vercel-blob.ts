import { put, del, head } from "@vercel/blob";
import type { StorageProvider } from "./types";

export class VercelBlobProvider implements StorageProvider {
  async upload(opts: { key: string; body: Buffer; contentType: string }): Promise<void> {
    await put(opts.key, opts.body, {
      access: "public",
      contentType: opts.contentType,
      addRandomSuffix: false,
    });
  }

  async getSignedUrl(key: string): Promise<string> {
    // Vercel Blob uses public URLs — no signing needed
    const blob = await head(key);
    return blob.url;
  }

  async delete(key: string): Promise<void> {
    // del() expects the full blob URL, so resolve it first
    const blob = await head(key);
    await del(blob.url);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await head(key);
      return true;
    } catch {
      return false;
    }
  }
}
