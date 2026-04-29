import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { auditLogs, user } from "@/lib/db/schema";

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function GET(request: Request) {
  const { response } = await requireAdminApiSession(request.headers);
  if (response) return response;

  const url = new URL(request.url);
  const action = url.searchParams.get("action")?.trim() || null;
  const entityType = url.searchParams.get("entityType")?.trim() || null;
  const userQuery = url.searchParams.get("user")?.trim() || null;
  const since = url.searchParams.get("since");
  const until = url.searchParams.get("until");
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit")) || PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const conditions = [];
  if (action) conditions.push(eq(auditLogs.action, action));
  if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
  if (userQuery) {
    const like = `%${userQuery}%`;
    conditions.push(or(ilike(user.email, like), ilike(user.name, like)));
  }
  if (since) {
    const date = new Date(since);
    if (!Number.isNaN(date.getTime())) conditions.push(gte(auditLogs.createdAt, date));
  }
  if (until) {
    const date = new Date(until);
    if (!Number.isNaN(date.getTime())) conditions.push(lte(auditLogs.createdAt, date));
  }
  const whereClause = conditions.length === 1 ? conditions[0] : conditions.length ? and(...conditions) : undefined;

  const rowsQuery = db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      userId: auditLogs.userId,
      userEmail: user.email,
      userName: user.name,
    })
    .from(auditLogs)
    .leftJoin(user, eq(user.id, auditLogs.userId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  const totalQuery = db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLogs)
    .leftJoin(user, eq(user.id, auditLogs.userId));

  const [rows, totalRow] = await Promise.all([
    whereClause ? rowsQuery.where(whereClause) : rowsQuery,
    whereClause ? totalQuery.where(whereClause) : totalQuery,
  ]);

  const total = totalRow[0]?.total ?? 0;

  const [actionRows, entityRows] = await Promise.all([
    db
      .selectDistinct({ value: auditLogs.action })
      .from(auditLogs)
      .orderBy(auditLogs.action),
    db
      .selectDistinct({ value: auditLogs.entityType })
      .from(auditLogs)
      .orderBy(auditLogs.entityType),
  ]);

  return NextResponse.json({
    ok: true,
    logs: rows,
    pagination: { total, limit, offset },
    facets: {
      actions: actionRows.map((row) => row.value).filter(Boolean),
      entityTypes: entityRows.map((row) => row.value).filter(Boolean),
    },
  });
}
