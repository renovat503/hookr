import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function createPostgresClient(url: string) {
  const needsSsl =
    /supabase\.(co|com)/i.test(url) ||
    process.env.DATABASE_SSL === "require" ||
    process.env.NODE_ENV === "production";

  return postgres(url, {
    prepare: false,
    max: 10,
    connect_timeout: 15,
    ...(needsSsl ? { ssl: "require" as const } : {}),
  });
}

export function getDb() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required when HOOKR_DATA_MODE is enabled.");
  }
  if (!db) {
    client = createPostgresClient(url);
    db = drizzle(client, { schema });
  }
  return db;
}

export async function closeDb() {
  if (client) {
    await client.end();
    client = null;
    db = null;
  }
}
