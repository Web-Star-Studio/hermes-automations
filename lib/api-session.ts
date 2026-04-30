import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { findUserByApiKey, type ResolvedApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";

export type ApiKeySession = ResolvedApiKey & {
  userStatus: "approved";
};

export type RequireApiKeySessionResult =
  | { session: ApiKeySession; response: null }
  | { session: null; response: NextResponse };

function unauthorized(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: "UNAUTHORIZED", message } },
    { status: 401 },
  );
}

function extractBearer(headersList: Headers): string | null {
  const raw = headersList.get("authorization") ?? headersList.get("Authorization");
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

export async function requireApiKeySession(
  headersList: Headers,
): Promise<RequireApiKeySessionResult> {
  const secret = extractBearer(headersList);
  if (!secret) {
    return { session: null, response: unauthorized("Authorization: Bearer obrigatorio.") };
  }

  const resolved = await findUserByApiKey(secret);
  if (!resolved) {
    return { session: null, response: unauthorized("API key invalida, revogada ou expirada.") };
  }

  const [owner] = await db
    .select({ status: user.status })
    .from(user)
    .where(eq(user.id, resolved.userId))
    .limit(1);

  if (!owner || owner.status !== "approved") {
    return {
      session: null,
      response: NextResponse.json(
        {
          ok: false,
          error: {
            code: "PENDING_APPROVAL",
            message: "Conta dona da API key nao esta aprovada.",
          },
        },
        { status: 403 },
      ),
    };
  }

  return {
    session: { ...resolved, userStatus: "approved" },
    response: null,
  };
}
