import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { isSupabasePoolerUrl, resolveDatabaseUrl } from "./connection-url";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let loggedConnection = false;

export function getDb() {
  const url = resolveDatabaseUrl();
  if (!db) {
    if (!loggedConnection) {
      loggedConnection = true;
      console.log(
        `[db] connecting (${isSupabasePoolerUrl(url) ? "supabase pooler" : "direct"})`,
      );
    }
    const needsSsl =
      /supabase\.(co|com)/i.test(url) ||
      process.env.DATABASE_SSL === "require" ||
      process.env.NODE_ENV === "production";

    client = postgres(url, {
      prepare: false,
      max: 10,
      connect_timeout: 15,
      ...(needsSsl ? { ssl: "require" as const } : {}),
    });
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
