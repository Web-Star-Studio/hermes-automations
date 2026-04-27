import { readFile } from "node:fs/promises";

export async function readUploadBytes(blobUrl: string): Promise<Buffer> {
  if (blobUrl.startsWith("local://")) {
    return readFile(blobUrl.replace("local://", ""));
  }

  const response = await fetch(blobUrl);

  if (!response.ok) {
    throw new Error(`Nao foi possivel ler arquivo armazenado (${response.status}).`);
  }

  return Buffer.from(await response.arrayBuffer());
}
