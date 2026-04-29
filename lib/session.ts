import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { auth, type Session } from "@/lib/auth";
import { isAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";

export async function getSessionFromHeaders(headersList: Headers) {
  return auth.api.getSession({ headers: headersList });
}

async function loadUserStatus(userId: string): Promise<string | null> {
  const rows = await db
    .select({ status: user.status })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return rows[0]?.status ?? null;
}

export async function isSessionApproved(session: Session): Promise<boolean> {
  if (isAdminSession(session)) return true;
  const status = await loadUserStatus(session.user.id);
  return status === "approved";
}

export async function requireApiSession(headersList: Headers) {
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

  if (!(await isSessionApproved(session))) {
    return {
      session: null,
      response: NextResponse.json(
        {
          ok: false,
          error: { code: "PENDING_APPROVAL", message: "Conta aguardando aprovação do administrador." },
        },
        { status: 403 },
      ),
    };
  }

  return { session, response: null };
}

export async function requirePageSession() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/sign-in");
  }

  if (!(await isSessionApproved(session))) {
    redirect("/pending");
  }

  return session;
}
