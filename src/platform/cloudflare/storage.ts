import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { BlobInfo, BlobStore } from "../ports/storage";

const FALLBACK_CONTENT_TYPE = "application/octet-stream";

/** The `FILES` R2 binding of the request (or scheduled run, or queue batch) being served. */
function bucket(): R2Bucket {
  return getCloudflareContext().env.FILES;
}

function infoOf(object: R2Object): BlobInfo {
  return {
    contentType: object.httpMetadata?.contentType ?? FALLBACK_CONTENT_TYPE,
    size: object.size,
  };
}

/** R2 through the Worker binding: no credentials, no S3 signing, no egress fees. */
export const r2BlobStore: BlobStore = {
  async put(key, body, { contentType }) {
    await bucket().put(key, body, { httpMetadata: { contentType } });
  },
  async get(key) {
    const object = await bucket().get(key);
    return object ? { ...infoOf(object), body: object.body } : null;
  },
  async head(key) {
    const object = await bucket().head(key);
    return object ? infoOf(object) : null;
  },
  async delete(key) {
    await bucket().delete(key);
  },
};
