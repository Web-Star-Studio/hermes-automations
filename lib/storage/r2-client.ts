import { S3Client } from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 client. R2 is S3-compatible — we use the AWS S3 SDK pointed
 * at R2's endpoint. The client is a singleton; create-once, reuse-forever.
 *
 * Required env:
 *   R2_ACCOUNT_ID         — Cloudflare account ID (R2 dashboard → bucket details)
 *   R2_ACCESS_KEY_ID      — token created in R2 → Manage R2 API Tokens
 *   R2_SECRET_ACCESS_KEY  — secret for the token above
 *   R2_BUCKET             — bucket name (e.g., "tiss-uploads-prod")
 */

let cached: S3Client | null = null;

export function getR2BucketName(): string | null {
  return process.env.R2_BUCKET ?? null;
}

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

export function getR2Client(): S3Client {
  if (cached) return cached;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 não configurado. Defina R2_ACCOUNT_ID, R2_ACCESS_KEY_ID e R2_SECRET_ACCESS_KEY.",
    );
  }

  cached = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cached;
}

/** Builds the canonical blob_url string we persist for R2 keys. */
export function buildR2Url(bucket: string, key: string): string {
  return `r2://${bucket}/${key}`;
}

/** Parses an `r2://bucket/path/to/key` URL into bucket + key. */
export function parseR2Url(url: string): { bucket: string; key: string } | null {
  if (!url.startsWith("r2://")) return null;
  const rest = url.slice("r2://".length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
}
