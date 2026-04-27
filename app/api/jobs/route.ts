import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobFiles, jobs, tissDocuments } from "@/lib/db/schema";
import { requireApiSession } from "@/lib/session";

export async function GET(request: Request) {
  const { session, response } = await requireApiSession(request.headers);
  if (response) return response;

  const rows = await db
    .select({
      job: jobs,
      file: jobFiles,
      tiss: tissDocuments,
    })
    .from(jobs)
    .leftJoin(jobFiles, eq(jobFiles.jobId, jobs.id))
    .leftJoin(tissDocuments, eq(tissDocuments.jobId, jobs.id))
    .where(eq(jobs.userId, session.user.id))
    .orderBy(desc(jobs.createdAt))
    .limit(50);

  return NextResponse.json({
    ok: true,
    jobs: rows.map(({ job, file, tiss }) => ({
      ...job,
      file,
      tiss,
    })),
  });
}
