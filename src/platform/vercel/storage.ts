import { BridgeHeader, storageRoute } from "../cloudflare/bridge/protocol";
import type { BlobInfo, BlobStore } from "../ports/storage";
import type { Bridge } from "./bridge";

const FALLBACK_CONTENT_TYPE = "application/octet-stream";

function infoOf(response: Response): BlobInfo {
  return {
    contentType: response.headers.get("content-type") ?? FALLBACK_CONTENT_TYPE,
    size: Number(response.headers.get(BridgeHeader.size) ?? 0),
  };
}

/** Fails on anything but success; `what` names the operation, never the key. */
async function expectOk(response: Response, what: string): Promise<void> {
  if (response.ok) return;
  const details = await response.text();
  throw new Error(`Storage ${what} failed through the platform bridge (HTTP ${response.status}): ${details}`);
}

/** The Cloudflare deployment's R2 bucket, through the platform bridge: files are streamed, not buffered, by the Worker. */
export function bridgeBlobStore(bridge: Bridge): BlobStore {
  return {
    async put(key, body, { contentType }) {
      await expectOk(await bridge.send("PUT", storageRoute(key, contentType), new Uint8Array(body)), "put");
    },
    async get(key) {
      const response = await bridge.send("GET", storageRoute(key));
      if (response.status === 404) return null;
      await expectOk(response, "get");
      if (!response.body) throw new Error("Storage get through the platform bridge returned no body");
      return { ...infoOf(response), body: response.body };
    },
    async head(key) {
      const response = await bridge.send("HEAD", storageRoute(key));
      if (response.status === 404) return null;
      await expectOk(response, "head");
      return infoOf(response);
    },
    async delete(key) {
      await expectOk(await bridge.send("DELETE", storageRoute(key)), "delete");
    },
  };
}
