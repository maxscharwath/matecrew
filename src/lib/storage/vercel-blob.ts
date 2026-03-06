import { put, del, head, getDownloadUrl } from "@vercel/blob";
import type { StorageProvider } from "./types";

export class VercelBlobProvider implements StorageProvider {
  async upload(opts: { key: string; body: Buffer; contentType: string }): Promise<void> {
    await put(opts.key, opts.body, {
      access: "private",
      contentType: opts.contentType,
      addRandomSuffix: false,
    });
  }

  async getSignedUrl(key: string): Promise<string> {
    const blob = await head(key);
    return getDownloadUrl(blob.url);
  }

  async delete(key: string): Promise<void> {
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
