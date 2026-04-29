import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { auditLogs, user, userStatusEnum, type UserStatus } from "@/lib/db/schema";

const validStatuses: readonly string[] = userStatusEnum.enumValues;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireAdminApiSession(request.headers);
  if (response) return response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const status = body?.status;

  if (!status || !validStatuses.includes(status)) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_STATUS", message: "Status inválido." } },
      { status: 400 },
    );
  }

  if (id === session!.user.id && status !== "approved") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "SELF_DEMOTION_FORBIDDEN",
          message: "Você não pode bloquear sua própria conta de admin.",
        },
      },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(user)
    .set({ status: status as UserStatus, updatedAt: new Date() })
    .where(eq(user.id, id))
    .returning({
      id: user.id,
      email: user.email,
      status: user.status,
    });

  if (!updated) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Usuário não encontrado." } },
      { status: 404 },
    );
  }

  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: session!.user.id,
    action: `user.status.${status}`,
    entityType: "user",
    entityId: updated.id,
    metadata: { targetEmail: updated.email, newStatus: status },
  });

  return NextResponse.json({ ok: true, user: updated });
}
