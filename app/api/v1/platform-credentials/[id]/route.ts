import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKeySession } from "@/lib/api-session";
import { db } from "@/lib/db";
import { auditLogs, platformCredentials } from "@/lib/db/schema";
import { encryptSecret, maskUsername } from "@/lib/security/credentials";

export const runtime = "nodejs";

const patchSchema = z
  .object({
    label: z.string().min(2).max(80).optional(),
    username: z.string().min(1).max(160).optional(),
    password: z.string().min(1).max(512).optional(),
  })
  .refine(
    (data) =>
      data.label !== undefined || data.username !== undefined || data.password !== undefined,
    { message: "Informe ao menos um campo para atualizar." },
  );

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function loadOwned(id: string, userId: string) {
  const [credential] = await db
    .select()
    .from(platformCredentials)
    .where(and(eq(platformCredentials.id, id), eq(platformCredentials.userId, userId)))
    .limit(1);
  return credential ?? null;
}

export async function GET(request: Request, { params }: RouteContext) {
  const { session, response } = await requireApiKeySession(request.headers);
  if (response) return response;

  const { id } = await params;
  const credential = await loadOwned(id, session.userId);
  if (!credential) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Credencial nao encontrada." } },
      { status: 404 },
    );
  }
  return NextResponse.json({
    ok: true,
    credential: {
      id: credential.id,
      platformId: credential.platformId,
      label: credential.label,
      usernameMasked: maskUsername(credential.username),
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    },
  });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { session, response } = await requireApiKeySession(request.headers);
  if (response) return response;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_BODY", message: parsed.error.issues[0]?.message ?? "Body invalido." } },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const credential = await loadOwned(id, session.userId);
  if (!credential) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Credencial nao encontrada." } },
      { status: 404 },
    );
  }

  const updates: Partial<typeof platformCredentials.$inferInsert> = { updatedAt: new Date() };
  const changedFields: string[] = [];

  if (body.label !== undefined && body.label !== credential.label) {
    updates.label = body.label;
    changedFields.push("label");
  }
  if (body.username !== undefined && body.username !== credential.username) {
    updates.username = body.username;
    changedFields.push("username");
  }
  if (body.password !== undefined) {
    const encrypted = encryptSecret(body.password);
    updates.encryptedPassword = encrypted.encryptedValue;
    updates.iv = encrypted.iv;
    updates.authTag = encrypted.authTag;
    changedFields.push("password");
  }

  try {
    await db.update(platformCredentials).set(updates).where(eq(platformCredentials.id, id));
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
    action: "api.platform_credential.updated",
    entityType: "platform_credential",
    entityId: id,
    metadata: {
      apiKeyId: session.apiKeyId,
      fields: changedFields,
      platformId: credential.platformId,
      userAgent: request.headers.get("user-agent"),
    },
  });

  const finalLabel = updates.label ?? credential.label;
  const finalUsername = updates.username ?? credential.username;

  return NextResponse.json({
    ok: true,
    credential: {
      id,
      platformId: credential.platformId,
      label: finalLabel,
      usernameMasked: maskUsername(finalUsername),
    },
  });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { session, response } = await requireApiKeySession(request.headers);
  if (response) return response;

  const { id } = await params;
  const credential = await loadOwned(id, session.userId);
  if (!credential) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Credencial nao encontrada." } },
      { status: 404 },
    );
  }

  try {
    await db.delete(platformCredentials).where(eq(platformCredentials.id, id));
  } catch (error) {
    const code =
      (error as { code?: string; cause?: { code?: string } })?.code ??
      (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "23503") {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "CREDENTIAL_IN_USE",
            message:
              "Esta credencial ja foi usada em um job e nao pode ser excluida. Atualize ou crie outra.",
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
    action: "api.platform_credential.deleted",
    entityType: "platform_credential",
    entityId: id,
    metadata: {
      apiKeyId: session.apiKeyId,
      label: credential.label,
      platformId: credential.platformId,
      userAgent: request.headers.get("user-agent"),
    },
  });

  return NextResponse.json({ ok: true });
}
