import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserPreferences, setUserPreferences } from "@/lib/db/user-preferences";
import { requireApiSession } from "@/lib/session";

const patchSchema = z.object({
  browserVisionEnabled: z.boolean().optional(),
});

export async function GET(request: Request) {
  const { session, response } = await requireApiSession(request.headers);
  if (response) return response;

  const preferences = await getUserPreferences(session.user.id);
  return NextResponse.json({ ok: true, preferences });
}

export async function PATCH(request: Request) {
  const { session, response } = await requireApiSession(request.headers);
  if (response) return response;

  const body = patchSchema.parse(await request.json());
  const current = await getUserPreferences(session.user.id);
  const merged = await setUserPreferences(session.user.id, { ...current, ...body });

  return NextResponse.json({ ok: true, preferences: merged });
}
