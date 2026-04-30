import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKeySession } from "@/lib/api-session";
import { db } from "@/lib/db";
import { auditLogs, platformCredentials } from "@/lib/db/schema";
import { ensurePlatform } from "@/lib/platforms";
import { encryptSecret, maskUsername } from "@/lib/security/credentials";

export const runtime = "nodejs";

const credentialSchema = z.object({
  platformId: z.literal("orizon_fature"),
  label: z.string().min(2).max(80),
  username: z.string().min(1).max(160),
  password: z.string().min(1).max(512),
});

export async function GET(request: Request) {
  const { session, response } = await requireApiKeySession(request.headers);
  if (response) return response;

  const credentials = await db
    .select()
    .from(platformCredentials)
    .where(eq(platformCredentials.userId, session.userId))
    .orderBy(desc(platformCredentials.createdAt));

  return NextResponse.json({
    ok: true,
    credentials: credentials.map((credential) => ({
      id: credential.id,
      platformId: credential.platformId,
      label: credential.label,
      usernameMasked: maskUsername(credential.username),
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    })),
  });
}

export async function POST(request: Request) {
  const { session, response } = await requireApiKeySession(request.headers);
  if (response) return response;

  const parsed = credentialSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_BODY", message: parsed.error.issues[0]?.message ?? "Body invalido." } },
      { status: 400 },
    );
  }
  const body = parsed.data;
  await ensurePlatform(body.platformId);

  const encrypted = encryptSecret(body.password);
  const credentialId = randomUUID();

  try {
    await db.insert(platformCredentials).values({
      id: credentialId,
      userId: session.userId,
      platformId: body.platformId,
      label: body.label,
      username: body.username,
      encryptedPassword: encrypted.encryptedValue,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });
  } catch (error) {
    const code =
      (error as { code?: string; cause?: { code?: string } })?.code ??
      (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "DUPLICATE_LABEL",
            message: "Ja existe uma credencial com esse rotulo para esta plataforma.",
          },
        },
        { status: 409 },
      );
    }
    throw error;
  }

  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: session.userId,
    action: "api.platform_credential.created",
    entityType: "platform_credential",
    entityId: credentialId,
    metadata: {
      apiKeyId: session.apiKeyId,
      platformId: body.platformId,
      label: body.label,
      userAgent: request.headers.get("user-agent"),
    },
  });

  return NextResponse.json({
    ok: true,
    credential: {
      id: credentialId,
      platformId: body.platformId,
      label: body.label,
      usernameMasked: maskUsername(body.username),
    },
  });
}
