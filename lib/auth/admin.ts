import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { Session } from "@/lib/auth";
import { auth } from "@/lib/auth";
import { getSessionFromHeaders } from "@/lib/session";

function adminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminSession(session: Session | null): boolean {
  if (!session) return false;
  const email = session.user.email?.toLowerCase();
  if (!email) return false;
  return adminEmails().includes(email);
}

export async function requireAdminPageSession(): Promise<Session> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (!isAdminSession(session)) notFound();
  return session;
}

export async function requireAdminApiSession(headersList: Headers) {
  const session = await getSessionFromHeaders(headersList);
  if (!session) {
    return {
      session: null,
      response: NextResponse.json(
        { ok: false, error: { code: "UNAUTHORIZED", message: "Sessao obrigatoria." } },
        { status: 401 },
      ),
    };
  }
  if (!isAdminSession(session)) {
    return {
      session: null,
      response: NextResponse.json(
        { ok: false, error: { code: "FORBIDDEN", message: "Acesso restrito." } },
        { status: 403 },
      ),
    };
  }
  return { session, response: null };
}
