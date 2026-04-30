import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { generateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { apiKeys, auditLogs } from "@/lib/db/schema";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";

const createSchema = z.object({
  label: z.string().min(2).max(80),
  expiresAt: z.string().datetime().optional(),
});

export async function GET(request: Request) {
  const { session, response } = await requireApiSession(request.headers);
  if (response) return response;

  const rows = await db
    .select({
      id: apiKeys.id,
      label: apiKeys.label,
      prefix: apiKeys.prefix,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, session.user.id))
    .orderBy(desc(apiKeys.createdAt));

  return NextResponse.json({ ok: true, apiKeys: rows });
}

export async function POST(request: Request) {
  const { session, response } = await requireApiSession(request.headers);
  if (response) return response;

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_BODY", message: parsed.error.issues[0]?.message ?? "Body invalido." } },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const generated = generateApiKey();
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

  await db.insert(apiKeys).values({
    id: generated.id,
    userId: session.user.id,
    label: body.label,
    prefix: generated.prefix,
    hashedKey: generated.hashedKey,
    expiresAt,
  });

  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: session.user.id,
    action: "api_key.created",
    entityType: "api_key",
    entityId: generated.id,
    metadata: { label: body.label, prefix: generated.prefix, expiresAt: expiresAt?.toISOString() ?? null },
  });

  return NextResponse.json({
    ok: true,
    // Secret is shown ONCE here. The hashed value is what we store; we cannot
    // retrieve the plaintext after this response.
    apiKey: {
      id: generated.id,
      label: body.label,
      prefix: generated.prefix,
      expiresAt,
      secret: generated.secret,
    },
  });
}
