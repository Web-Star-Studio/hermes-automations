import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platforms, type PlatformId } from "@/lib/db/schema";

export const ORIZON_LOGIN_URL =
  "https://sso-fature.orizon.com.br/auth/realms/orizon-dativa/protocol/openid-connect/auth?client_id=fature_client&response_type=code&scope=openid&redirect_uri=https://sso-auth-codeflow-fature-apicast-production.api.ocppr.orizon.com.br/sso/token?user_key=32efd36b405a07b8c0e6c6cb9c582047";

export async function ensurePlatform(platformId: PlatformId) {
  if (platformId !== "orizon_fature") {
    throw new Error("Plataforma nao suportada no MVP.");
  }

  await db
    .insert(platforms)
    .values({
      id: "orizon_fature",
      name: "Orizon Fature",
      loginUrl: ORIZON_LOGIN_URL,
    })
    .onConflictDoUpdate({
      target: platforms.id,
      set: {
        name: "Orizon Fature",
        loginUrl: ORIZON_LOGIN_URL,
        updatedAt: new Date(),
      },
    });

  const [platform] = await db
    .select()
    .from(platforms)
    .where(eq(platforms.id, platformId))
    .limit(1);

  return platform;
}
