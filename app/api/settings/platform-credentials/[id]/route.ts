import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLogs, platformCredentials } from "@/lib/db/schema";
import { encryptSecret, maskUsername } from "@/lib/security/credentials";
import { requireApiSession } from "@/lib/session";

const patchSchema = z
  .object({
    label: z.string().min(2).max(80).optional(),
    username: z.string().min(1).max(160).optional(),
    password: z.string().min(1).max(512).optional(),
  })
  .refine(
    (data) => data.label !== undefined || data.username !== undefined || data.password !== undefined,
    { message: "Informe ao menos um campo para atualizar." },
  );

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  const { session, response } = await requireApiSession(request.headers);
  if (response) return response;

  const { id } = await params;
  const body = patchSchema.parse(await request.json());

  const [credential] = await db
    .select()
    .from(platformCredentials)
    .where(and(eq(platformCredentials.id, id), eq(platformCredentials.userId, session.user.id)))
    .limit(1);

  if (!credential) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Credencial não encontrada." } },
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
    await db
      .update(platformCredentials)
      .set(updates)
      .where(eq(platformCredentials.id, id));
  } catch (error) {
    const code =
      (error as { code?: string; cause?: { code?: string } })?.code ??
      (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      return NextResponse.json(
        { ok: false, error: { message: "Já existe uma credencial com esse rótulo para esta plataforma." } },
        { status: 409 },
      );
    }
    throw error;
  }

  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: session.user.id,
    action: "platform_credential.updated",
    entityType: "platform_credential",
    entityId: id,
    metadata: { fields: changedFields, platformId: credential.platformId },
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
  const { session, response } = await requireApiSession(request.headers);
  if (response) return response;

  const { id } = await params;

  const [credential] = await db
    .select({ id: platformCredentials.id, label: platformCredentials.label, platformId: platformCredentials.platformId })
    .from(platformCredentials)
    .where(and(eq(platformCredentials.id, id), eq(platformCredentials.userId, session.user.id)))
    .limit(1);

  if (!credential) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Credencial não encontrada." } },
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
            message: "Esta credencial já foi usada em um job e não pode ser excluída. Atualize ou crie outra.",
          },
        },
        { status: 409 },
      );
    }
    throw error;
  }

  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: session.user.id,
    action: "platform_credential.deleted",
    entityType: "platform_credential",
    entityId: id,
    metadata: { label: credential.label, platformId: credential.platformId },
  });

  return NextResponse.json({ ok: true });
}
