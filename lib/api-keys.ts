import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";

const KEY_PREFIX = "hapi_";
const PREFIX_DISPLAY_LENGTH = 8;

export type GeneratedApiKey = {
  id: string;
  secret: string;
  prefix: string;
  hashedKey: string;
};

export type ResolvedApiKey = {
  apiKeyId: string;
  userId: string;
};

function base32(buf: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 0x1f];
  return out;
}

export function generateApiKey(): GeneratedApiKey {
  const body = base32(randomBytes(20)).toLowerCase();
  const secret = `${KEY_PREFIX}${body}`;
  return {
    id: randomUUID(),
    secret,
    prefix: secret.slice(0, KEY_PREFIX.length + PREFIX_DISPLAY_LENGTH),
    hashedKey: hashApiKey(secret),
  };
}

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function isApiKeyShape(secret: string): boolean {
  return secret.startsWith(KEY_PREFIX) && secret.length >= KEY_PREFIX.length + 16;
}

export async function findUserByApiKey(secret: string): Promise<ResolvedApiKey | null> {
  if (!isApiKeyShape(secret)) return null;

  const hashed = hashApiKey(secret);
  const [row] = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId, expiresAt: apiKeys.expiresAt })
    .from(apiKeys)
    .where(and(eq(apiKeys.hashedKey, hashed), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

  await db
    .update(apiKeys)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(apiKeys.id, row.id));

  return { apiKeyId: row.id, userId: row.userId };
}
