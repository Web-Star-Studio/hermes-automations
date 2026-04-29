import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  buildR2Url,
  getR2BucketName,
  getR2Client,
  isR2Configured,
} from "@/lib/storage/r2-client";

export type SavedUpload = {
  fileName: string;
  contentType: string;
  size: number;
  checksum: string;
  blobUrl: string;
  pathname: string;
};

const maxUploadBytes = 25 * 1024 * 1024;

export async function saveUpload(file: File, userId: string): Promise<SavedUpload> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const extension = path.extname(file.name).toLowerCase();

  if (![".xml", ".zip"].includes(extension)) {
    throw new Error("Apenas arquivos .xml ou .zip sao aceitos.");
  }

  if (bytes.byteLength > maxUploadBytes) {
    throw new Error("Arquivo excede o limite de 25 MB.");
  }

  const checksum = createHash("sha256").update(bytes).digest("hex");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Object key inside the bucket. Used both as R2 key and as a local-fs path
  // when R2 is not configured (development fallback only).
  const key = `uploads/${userId}/${randomUUID()}-${safeName}`;
  const contentType = file.type || inferContentType(extension);

  if (isR2Configured()) {
    const bucket = getR2BucketName()!;
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        // Defense in depth: the bucket itself should be private (no public
        // access). We never expose the object URL — reads go through the
        // server which uses the SDK to fetch.
        Metadata: { checksum, userId },
      }),
    );

    return {
      fileName: file.name,
      contentType,
      size: bytes.byteLength,
      checksum,
      blobUrl: buildR2Url(bucket, key),
      pathname: key,
    };
  }

  // Local-fs fallback for `pnpm dev` without R2 credentials. The path is
  // ephemeral on Vercel and is intentionally NOT used in production.
  const localPath = path.join(process.cwd(), ".local-uploads", key);
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, bytes);

  return {
    fileName: file.name,
    contentType,
    size: bytes.byteLength,
    checksum,
    blobUrl: `local://${localPath}`,
    pathname: localPath,
  };
}

function inferContentType(extension: string) {
  return extension === ".zip" ? "application/zip" : "application/xml";
}
