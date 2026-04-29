import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobEvents, jobs, portalSessions } from "@/lib/db/schema";
import { isAdminSession } from "@/lib/auth/admin";
import { getBrowserbaseSession } from "@/lib/browserbase/sessions";
import { requireApiSession } from "@/lib/session";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { session, response } = await requireApiSession(request.headers);
  if (response) return response;

  const { jobId } = await params;

  const [job] = await db
    .select({ id: jobs.id, userId: jobs.userId })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!job) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Job não encontrado." } },
      { status: 404 },
    );
  }

  if (job.userId !== session.user.id && !isAdminSession(session)) {
    return NextResponse.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Acesso negado." } },
      { status: 403 },
    );
  }

  const [portalRows, eventRows] = await Promise.all([
    db
      .select({
        id: portalSessions.browserbaseSessionId,
        firstSeen: portalSessions.createdAt,
        status: portalSessions.status,
      })
      .from(portalSessions)
      .where(eq(portalSessions.jobId, jobId)),
    db
      .select({
        id: sql<string>`${jobEvents.payload}->>'sessionId'`,
        firstSeen: sql<Date>`min(${jobEvents.createdAt})`,
      })
      .from(jobEvents)
      .where(
        and(
          eq(jobEvents.jobId, jobId),
          sql`${jobEvents.payload}->>'sessionId' IS NOT NULL`,
        ),
      )
      .groupBy(sql`${jobEvents.payload}->>'sessionId'`),
  ]);

  const merged = new Map<string, { firstSeen: Date; portalStatus: string | null }>();
  for (const row of portalRows) {
    if (!row.id) continue;
    merged.set(row.id, { firstSeen: row.firstSeen, portalStatus: row.status });
  }
  for (const row of eventRows) {
    if (!row.id) continue;
    if (!merged.has(row.id)) {
      merged.set(row.id, { firstSeen: row.firstSeen, portalStatus: null });
    }
  }

  const sessionIds = Array.from(merged.keys());
  const enriched = await Promise.all(
    sessionIds.map(async (id) => {
      const local = merged.get(id)!;
      const remote = await getBrowserbaseSession(id);
      return {
        id,
        firstSeen: local.firstSeen,
        portalStatus: local.portalStatus,
        remote,
      };
    }),
  );

  enriched.sort(
    (a, b) =>
      new Date(b.firstSeen).getTime() - new Date(a.firstSeen).getTime(),
  );

  return NextResponse.json({ ok: true, sessions: enriched });
}
