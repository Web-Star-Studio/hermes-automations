import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";

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
  const pathname = `uploads/${userId}/${randomUUID()}-${safeName}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(pathname, bytes, {
      access: "private",
      contentType: file.type || inferContentType(extension),
    });

    return {
      fileName: file.name,
      contentType: blob.contentType ?? inferContentType(extension),
      size: bytes.byteLength,
      checksum,
      blobUrl: blob.url,
      pathname,
    };
  }

  const localPath = path.join(process.cwd(), ".local-uploads", pathname);
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, bytes);

  return {
    fileName: file.name,
    contentType: file.type || inferContentType(extension),
    size: bytes.byteLength,
    checksum,
    blobUrl: `local://${localPath}`,
    pathname: localPath,
  };
}

function inferContentType(extension: string) {
  return extension === ".zip" ? "application/zip" : "application/xml";
}
