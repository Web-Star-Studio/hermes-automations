import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  buildR2Url,
  getR2BucketName,
  getR2Client,
  isR2Configured,
} from "@/lib/storage/r2-client";

// Server-side helper for persisting Buffers (screenshots, DOM snapshots,
// recovery diagnostics) outside the SavedUpload pipeline, which is shaped for
// File objects from the upload form.

export type StoredAsset = {
  /** R2 object key OR local-fs absolute path. */
  pathname: string;
  /** Canonical r2://bucket/key URL when stored in R2; local:// path otherwise. */
  blobUrl: string;
  size: number;
};

export async function saveBytes(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<StoredAsset> {
  if (isR2Configured()) {
    const bucket = getR2BucketName()!;
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
    return {
      pathname: key,
      blobUrl: buildR2Url(bucket, key),
      size: bytes.byteLength,
    };
  }

  // Local-fs fallback for `pnpm dev` without R2 credentials.
  const localPath = path.join(process.cwd(), ".local-uploads", key);
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, bytes);
  return {
    pathname: localPath,
    blobUrl: `local://${localPath}`,
    size: bytes.byteLength,
  };
}
