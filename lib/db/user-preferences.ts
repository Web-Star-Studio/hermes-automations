import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userPreferences } from "@/lib/db/schema";

export type UserPreferences = {
  browserVisionEnabled: boolean;
};

const defaults: UserPreferences = {
  browserVisionEnabled: false,
};

export async function getUserPreferences(userId: string): Promise<UserPreferences> {
  const [row] = await db
    .select({ browserVisionEnabled: userPreferences.browserVisionEnabled })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (!row) return defaults;
  return { browserVisionEnabled: row.browserVisionEnabled };
}

export async function setUserPreferences(
  userId: string,
  patch: Partial<UserPreferences>,
): Promise<UserPreferences> {
  const merged: UserPreferences = { ...defaults, ...patch };
  await db
    .insert(userPreferences)
    .values({
      userId,
      browserVisionEnabled: merged.browserVisionEnabled,
    })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        browserVisionEnabled: merged.browserVisionEnabled,
        updatedAt: new Date(),
      },
    });
  return merged;
}
