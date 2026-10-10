/**
 * Blob storage: immutable files addressed by an opaque key such as
 * `items/<itemId>/<uuid>-image.webp`.
 *
 * Keys are built by the app (src/lib/storage.ts) and never reused for other
 * content, so a stored object can be cached forever. Adapters keep the key
 * as-is: no prefix, no random suffix, no extension rewriting.
 */

/** What is known about a stored object without reading it. */
export interface BlobInfo {
  /** MIME type given when the object was stored. */
  readonly contentType: string;
  /** Size in bytes. */
  readonly size: number;
}

/** A stored object, streamed. The body can be read once. */
export interface BlobObject extends BlobInfo {
  readonly body: ReadableStream<Uint8Array>;
}

export interface BlobStore {
  /** Stores `body` under `key`, replacing any object already there. */
  put(key: string, body: Uint8Array, options: { readonly contentType: string }): Promise<void>;
  /** The object under `key`, or null when there is none. */
  get(key: string): Promise<BlobObject | null>;
  /** The object's metadata, or null when there is none. Must not report an outage as missing. */
  head(key: string): Promise<BlobInfo | null>;
  /** Removes the object; removing a missing key is not an error. */
  delete(key: string): Promise<void>;
}

/** Reads a whole object into memory, for callers that need the bytes (mail attachments, image processing). */
export async function readBlobBytes(blob: BlobObject): Promise<Uint8Array> {
  return new Uint8Array(await new Response(blob.body).arrayBuffer());
}
