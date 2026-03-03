import {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
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
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uuid = crypto.randomUUID();
  return `invoices/${purchaseBatchId}/${uuid}-${sanitized}`;
}
