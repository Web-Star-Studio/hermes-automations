import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { jobs, user, userStatusEnum } from "@/lib/db/schema";

export async function GET(request: Request) {
  const { response } = await requireAdminApiSession(request.headers);
  if (response) return response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const queryParam = url.searchParams.get("q")?.trim() || null;

  const validStatuses: readonly string[] = userStatusEnum.enumValues;
  const status =
    statusParam && validStatuses.includes(statusParam)
      ? (statusParam as (typeof userStatusEnum.enumValues)[number])
      : null;

  const conditions = [];
  if (status) conditions.push(eq(user.status, status));
  if (queryParam) {
    const like = `%${queryParam}%`;
    conditions.push(or(ilike(user.email, like), ilike(user.name, like)));
  }

  const whereClause =
    conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);

  const query = db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      createdAt: user.createdAt,
      jobCount: sql<number>`count(${jobs.id})::int`,
    })
    .from(user)
    .leftJoin(jobs, eq(jobs.userId, user.id))
    .groupBy(user.id)
    .orderBy(desc(user.createdAt));

  const rows = whereClause ? await query.where(whereClause) : await query;

  return NextResponse.json({
    ok: true,
    users: rows,
    statuses: userStatusEnum.enumValues,
  });
}
