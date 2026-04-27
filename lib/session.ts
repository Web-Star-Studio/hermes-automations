import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function getSessionFromHeaders(headersList: Headers) {
  return auth.api.getSession({ headers: headersList });
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

  return { session, response: null };
}

export async function requirePageSession() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/sign-in");
  }

  return session;
}
