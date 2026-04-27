import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";

function getEncryptionKey() {
  const configured = process.env.CREDENTIAL_ENCRYPTION_KEY;

  if (!configured) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is required to encrypt platform credentials.");
  }

  if (/^[a-f0-9]{64}$/i.test(configured)) {
    return Buffer.from(configured, "hex");
  }

  try {
    const decoded = Buffer.from(configured, "base64");
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // Fall through to deterministic hash.
  }

  return createHash("sha256").update(configured).digest();
}

export type EncryptedSecret = {
  encryptedValue: string;
  iv: string;
  authTag: string;
};

export function encryptSecret(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  return {
    encryptedValue: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv(
    algorithm,
    getEncryptionKey(),
    Buffer.from(secret.iv, "base64"),
  );

  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(secret.encryptedValue, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskUsername(username: string) {
  if (username.length <= 3) {
    return "***";
  }

  return `${username.slice(0, 2)}***${username.slice(-2)}`;
}
