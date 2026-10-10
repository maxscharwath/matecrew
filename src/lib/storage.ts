/**
 * Storage keys and the URLs files are served from. The bytes themselves go
 * through `platform.storage` (src/platform/ports/storage.ts).
 */

// --- Key builders ---

/** `<prefix>/<id>/<uuid>-<sanitized filename>` — a unique, path-safe key. */
function buildScopedKey(prefix: string, id: string, filename: string): string {
  const sanitized = filename.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  return `${prefix}/${id}/${crypto.randomUUID()}-${sanitized}`;
}

export function buildInvoiceKey(
  purchaseBatchId: string,
  filename: string
): string {
  return buildScopedKey("invoices", purchaseBatchId, filename);
}

export function buildAvatarKey(userId: string): string {
  return `avatars/${userId}/${crypto.randomUUID()}.jpg`;
}

export function buildItemImageKey(itemId: string, filename: string): string {
  return buildScopedKey("items", itemId, filename);
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

/** Build an internal `/api/files/...` URL for a storage key. */
export function internalFileUrl(key: string): string {
  return `/api/files/${key}`;
}

/** Resolve a user `image` field to a displayable URL. */
export function resolveAvatarUrl(
  image: string | null | undefined
): string | undefined {
  if (!image) return undefined;
  if (image.startsWith("avatars/")) return internalFileUrl(image);
  return image;
}

/** Resolve an item `imageKey` to a displayable URL. */
export function resolveItemImageUrl(
  imageKey: string | null | undefined
): string | undefined {
  if (!imageKey) return undefined;
  if (imageKey.startsWith("items/")) return internalFileUrl(imageKey);
  return imageKey;
}
