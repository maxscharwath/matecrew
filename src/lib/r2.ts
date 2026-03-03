import { S3Client } from "@aws-sdk/client-s3";

const isDev = process.env.NODE_ENV === "development";

export const r2 = new S3Client(
  isDev
    ? {
        region: "us-east-1",
        endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin",
          secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin",
        },
        forcePathStyle: true, // required for MinIO
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

export const R2_BUCKET = process.env.R2_BUCKET_NAME ?? "matecrew-invoices";
