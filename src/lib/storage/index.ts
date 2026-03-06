import type { StorageProvider } from "./types";

export type { StorageProvider } from "./types";

function createProvider(): StorageProvider {
  const provider = process.env.STORAGE_PROVIDER ?? "vercel-blob";

  switch (provider) {
    case "r2": {
      const { R2Provider } = require("./r2") as typeof import("./r2");
      return new R2Provider();
    }
    case "vercel-blob": {
      const { VercelBlobProvider } = require("./vercel-blob") as typeof import("./vercel-blob");
      return new VercelBlobProvider();
    }
    default:
      throw new Error(`Unknown STORAGE_PROVIDER: ${provider}`);
  }
}

const storage = createProvider();
export default storage;

// --- Convenience wrappers (drop-in replacements for old r2-helpers) ---

export async function uploadFile(opts: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  await storage.upload(opts);
}

export async function getSignedUrl(
  key: string,
  expiresIn = 3600
): Promise<string> {
  return storage.getSignedUrl(key, expiresIn);
}

export async function deleteFile(key: string): Promise<void> {
  await storage.delete(key);
}

export async function fileExists(key: string): Promise<boolean> {
  return storage.exists(key);
}

// --- Key builders ---

export function buildInvoiceKey(
  purchaseBatchId: string,
  filename: string
): string {
  const sanitized = filename.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  const uuid = crypto.randomUUID();
  return `invoices/${purchaseBatchId}/${uuid}-${sanitized}`;
}

export function buildAvatarKey(userId: string, filename: string): string {
  const sanitized = filename.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  const uuid = crypto.randomUUID();
  return `avatars/${userId}/${uuid}-${sanitized}`;
}

const PDF_VERSION = "v2";

export function buildSettlementKey(periodId: string): string {
  return `reimbursements/${PDF_VERSION}/${periodId}/settlement.pdf`;
}

export function buildUserSettlementKey(
  periodId: string,
  userId: string
): string {
  return `reimbursements/${PDF_VERSION}/${periodId}/user-${userId}.pdf`;
}

/** Resolve a user `image` field to a displayable URL. */
export async function resolveAvatarUrl(
  image: string | null | undefined
): Promise<string | undefined> {
  if (!image) return undefined;
  if (image.startsWith("avatars/")) return getSignedUrl(image);
  return image;
}
