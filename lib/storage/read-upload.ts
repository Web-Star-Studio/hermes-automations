import { readFile } from "node:fs/promises";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client, parseR2Url } from "@/lib/storage/r2-client";

/**
 * Reads an uploaded file by its persisted blob_url. Three URL shapes are
 * supported:
 *   - r2://<bucket>/<key>            — fetched via the S3 SDK (production).
 *   - local:///abs/path              — read from disk (dev fallback).
 *   - https://...                    — public fetch (legacy Vercel Blob).
 */
export async function readUploadBytes(blobUrl: string): Promise<Buffer> {
  const r2 = parseR2Url(blobUrl);
  if (r2) {
    const response = await getR2Client().send(
      new GetObjectCommand({ Bucket: r2.bucket, Key: r2.key }),
    );
    if (!response.Body) {
      throw new Error(`R2 retornou body vazio para ${r2.key}.`);
    }
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  if (blobUrl.startsWith("local://")) {
    return readFile(blobUrl.replace("local://", ""));
  }

  // Legacy: Vercel Blob URLs (or any other public URL the file was saved to
  // before the R2 migration). New uploads after this change use r2:// keys.
  const response = await fetch(blobUrl);
  if (!response.ok) {
    throw new Error(`Nao foi possivel ler arquivo armazenado (${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}
