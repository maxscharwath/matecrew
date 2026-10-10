import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileBlobStore } from "../../src/platform/node/storage";
import { runInBackground, settleBackground } from "../../src/platform/node/background";
import { createProcessEnv } from "../../src/platform/shared/process-env";
import { readBlobBytes } from "../../src/platform/ports/storage";

test("the local blob store keeps bytes and content type under the same key", async () => {
  const root = await mkdtemp(join(tmpdir(), "matecrew-blobs-"));
  try {
    const store = createFileBlobStore(root);
    const key = "items/item-1/uuid-image.webp";
    assert.equal(await store.get(key), null);
    assert.equal(await store.head(key), null);

    await store.put(key, new Uint8Array([1, 2, 3]), { contentType: "image/webp" });
    assert.deepEqual(await store.head(key), { size: 3, contentType: "image/webp" });
    const blob = await store.get(key);
    assert.ok(blob);
    assert.deepEqual([...(await readBlobBytes(blob))], [1, 2, 3]);

    await store.delete(key);
    await store.delete(key);
    assert.equal(await store.head(key), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the local blob store refuses keys that leave its root", async () => {
  const store = createFileBlobStore(join(tmpdir(), "matecrew-blobs-root"));
  await assert.rejects(store.put("../outside.pdf", new Uint8Array(), { contentType: "application/pdf" }));
});

test("a failing background task is logged, never thrown at the caller", async () => {
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args[0]);
  try {
    runInBackground(Promise.reject(new Error("boom")), "test task");
    await settleBackground();
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, ["[background] test task failed"]);
});

test("the base URL prefers BETTER_AUTH_URL and drops trailing slashes", () => {
  const saved = { auth: process.env.BETTER_AUTH_URL, app: process.env.NEXT_PUBLIC_APP_URL };
  try {
    process.env.BETTER_AUTH_URL = "https://matecrew.example.workers.dev//";
    process.env.NEXT_PUBLIC_APP_URL = "https://other.example";
    assert.equal(createProcessEnv().baseUrl(), "https://matecrew.example.workers.dev");

    process.env.BETTER_AUTH_URL = "";
    assert.equal(createProcessEnv().baseUrl(), "https://other.example");
    assert.equal(createProcessEnv().get("BETTER_AUTH_URL"), undefined);
    assert.throws(() => createProcessEnv().require("BETTER_AUTH_URL"), /BETTER_AUTH_URL/);
  } finally {
    restore("BETTER_AUTH_URL", saved.auth);
    restore("NEXT_PUBLIC_APP_URL", saved.app);
  }
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
