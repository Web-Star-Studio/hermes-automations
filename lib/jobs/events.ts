import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { jobEvents } from "@/lib/db/schema";

export async function appendJobEvent(input: {
  jobId: string;
  type: string;
  message: string;
  payload?: Record<string, unknown>;
}) {
  const [event] = await db
    .insert(jobEvents)
    .values({
      id: randomUUID(),
      jobId: input.jobId,
      type: input.type,
      message: input.message,
      payload: input.payload ?? {},
    })
    .returning();

  return event;
}
