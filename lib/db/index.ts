import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "@/lib/db/schema";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://user:password@localhost:5432/tiss_agent";

export const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
});

export const db = drizzle(sql, { schema });
