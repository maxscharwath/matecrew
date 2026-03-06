import {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { DownloadResult, StorageProvider } from "./types";

function createClient(): S3Client {
  const isDev = process.env.NODE_ENV === "development";
  return new S3Client(
    isDev
      ? {
          region: "us-east-1",
          endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin",
            secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin",
          },
          forcePathStyle: true,
        }
      : {
          region: "auto",
          endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID!,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
          },
        }
  );
}

export class R2Provider implements StorageProvider {
  private client = createClient();
  private bucket = process.env.R2_BUCKET_NAME ?? "matecrew-invoices";

  async upload(opts: { key: string; body: Buffer; contentType: string }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: opts.key,
        Body: opts.body,
        ContentType: opts.contentType,
      })
    );
  }

  async download(key: string): Promise<DownloadResult> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    const stream = res.Body as ReadableStream<Uint8Array>;
    return {
      body: stream,
      contentType: res.ContentType ?? "application/octet-stream",
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return true;
    } catch {
      return false;
    }
  }
}
