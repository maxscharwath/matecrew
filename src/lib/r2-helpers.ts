import {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, R2_BUCKET } from "@/lib/r2";

export async function uploadToR2(opts: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType,
    })
  );
}

export async function getR2SignedUrl(
  key: string,
  expiresIn = 3600
): Promise<string> {
  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    { expiresIn }
  );
}

export async function deleteFromR2(key: string): Promise<void> {
  await r2.send(
    new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key })
  );
}

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

/** Resolve a user `image` field to a displayable URL. */
export async function resolveAvatarUrl(
  image: string | null | undefined,
): Promise<string | undefined> {
  if (!image) return undefined;
  if (image.startsWith("avatars/")) return getR2SignedUrl(image);
  return image;
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

export async function r2ObjectExists(key: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}
