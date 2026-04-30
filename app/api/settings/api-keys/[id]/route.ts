import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiKeys, auditLogs } from "@/lib/db/schema";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: Request, { params }: RouteContext) {
  const { session, response } = await requireApiSession(request.headers);
  if (response) return response;

  const { id } = await params;
  const [row] = await db
    .select({ id: apiKeys.id, label: apiKeys.label, prefix: apiKeys.prefix })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.id, id),
        eq(apiKeys.userId, session.user.id),
        isNull(apiKeys.revokedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "API key nao encontrada ou ja revogada." } },
      { status: 404 },
    );
  }

  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.id, id));

  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: session.user.id,
    action: "api_key.revoked",
    entityType: "api_key",
    entityId: id,
    metadata: { label: row.label, prefix: row.prefix },
  });

  return NextResponse.json({ ok: true });
}
