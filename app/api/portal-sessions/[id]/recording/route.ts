import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isAdminSession } from "@/lib/auth/admin";
import { getBrowserbaseRecording } from "@/lib/browserbase/sessions";
import { db } from "@/lib/db";
import { jobEvents, jobs, portalSessions } from "@/lib/db/schema";
import { requireApiSession } from "@/lib/session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { session, response } = await requireApiSession(request.headers);
  if (response) return response;

  const { id: sessionId } = await params;

  const userOwnsSession = await sessionBelongsToUser(sessionId, session.user.id);
  if (!userOwnsSession && !isAdminSession(session)) {
    return NextResponse.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Acesso negado." } },
      { status: 403 },
    );
  }

  const events = await getBrowserbaseRecording(sessionId);
  if (!events) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Recording indisponível." } },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, sessionId, events });
}

async function sessionBelongsToUser(sessionId: string, userId: string) {
  const [portalMatch] = await db
    .select({ id: portalSessions.id })
    .from(portalSessions)
    .where(
      and(eq(portalSessions.browserbaseSessionId, sessionId), eq(portalSessions.userId, userId)),
    )
    .limit(1);

  if (portalMatch) return true;

  const [eventMatch] = await db
    .select({ id: jobEvents.id })
    .from(jobEvents)
    .innerJoin(jobs, eq(jobs.id, jobEvents.jobId))
    .where(
      and(
        eq(jobs.userId, userId),
        sql`${jobEvents.payload}->>'sessionId' = ${sessionId}`,
      ),
    )
    .limit(1);

  return Boolean(eventMatch);
}
