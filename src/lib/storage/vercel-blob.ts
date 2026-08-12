import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";
import type { DownloadResult, StorageProvider } from "./types";

/**
 * Vercel Blob adapter.
 *
 * Operation *class* matters as much as operation count here. Vercel counts
 * `put()`, `copy()` and `list()` as **advanced** operations — 2,000/month on
 * Hobby — while `head()` and fetching a blob by its URL are **simple**, with a
 * 10,000/month allowance.
 *
 * This adapter therefore never calls `list()`. It used to resolve every key to
 * a URL with `list({ prefix: key, limit: 1 })`, which meant one advanced
 * operation per *read*: every avatar and item image on every page view. That
 * exhausted the monthly advanced quota and suspended the whole store, so images
 * started 404ing site-wide.
 *
 * `get()`, `head()` and `del()` all accept a pathname and derive the URL from
 * the token's store id, so the key alone is enough. The only advanced operation
 * left is `put()`, once per actual upload.
 *
 * @see https://vercel.com/docs/vercel-blob/usage-and-pricing
 */
export class VercelBlobProvider implements StorageProvider {
  /** The one advanced operation, and only when a file is genuinely uploaded. */
  async upload(opts: { key: string; body: Buffer; contentType: string }): Promise<void> {
    await put(opts.key, opts.body, {
      access: "private",
      contentType: opts.contentType,
      // Keeps the stored pathname identical to our key, which is what lets
      // every other method address the blob without a lookup.
      addRandomSuffix: false,
    });
  }

  async download(key: string): Promise<DownloadResult> {
    // Simple operation, and free when the CDN already holds the object
    // (`useCache` defaults to true).
    const result = await get(key, { access: "private" });
    if (!result) throw new Error(`Blob not found: ${key}`);
    if (result.statusCode !== 200) {
      // 304 only happens if we send ifNoneMatch, which we don't.
      throw new Error(`Unexpected blob status ${result.statusCode} for ${key}`);
    }
    return {
      body: result.stream,
      contentType: result.blob.contentType,
    };
  }

  async delete(key: string): Promise<void> {
    // Deleting a key that isn't there is a no-op, so no existence check first.
    await del(key);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await head(key);
      return true;
    } catch (error) {
      if (error instanceof BlobNotFoundError) return false;
      // A suspended store or network fault must not be reported as "missing",
      // or callers would regenerate and re-upload a file that already exists.
      throw error;
    }
  }
}
