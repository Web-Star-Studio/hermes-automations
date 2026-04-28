import { count, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobFiles, jobs, tissDocuments } from "@/lib/db/schema";
import { requireApiSession } from "@/lib/session";

export async function GET(request: Request) {
  const { session, response } = await requireApiSession(request.headers);
  if (response) return response;

  const baseRows = await db
    .select({ job: jobs, tiss: tissDocuments })
    .from(jobs)
    .leftJoin(tissDocuments, eq(tissDocuments.jobId, jobs.id))
    .where(eq(jobs.userId, session.user.id))
    .orderBy(desc(jobs.createdAt))
    .limit(50);

  const jobIds = baseRows.map((r) => r.job.id);

  const [fileCounts, firstFiles] = jobIds.length
    ? await Promise.all([
        db
          .select({ jobId: jobFiles.jobId, count: count() })
          .from(jobFiles)
          .where(inArray(jobFiles.jobId, jobIds))
          .groupBy(jobFiles.jobId),
        db
          .select({
            jobId: jobFiles.jobId,
            fileName: jobFiles.fileName,
            createdAt: jobFiles.createdAt,
            rowNum: sql<number>`row_number() over (partition by ${jobFiles.jobId} order by ${jobFiles.createdAt} asc)`.as(
              "row_num",
            ),
          })
          .from(jobFiles)
          .where(inArray(jobFiles.jobId, jobIds)),
      ])
    : [[], []];

  const countByJob = new Map(fileCounts.map((c) => [c.jobId, c.count]));
  const firstByJob = new Map(
    firstFiles.filter((f) => f.rowNum === 1).map((f) => [f.jobId, f.fileName]),
  );

  return NextResponse.json({
    ok: true,
    jobs: baseRows.map(({ job, tiss }) => ({
      ...job,
      file: firstByJob.has(job.id) ? { fileName: firstByJob.get(job.id) ?? "" } : null,
      fileCount: countByJob.get(job.id) ?? 0,
      tiss,
    })),
  });
}
