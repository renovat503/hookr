import { closeDb } from "@/lib/db/client";
import { withQueryTimeout } from "@/lib/db/query-timeout";

export const DB_QUERY_TIMEOUT_MS = 10_000;

export async function dbQuery<T>(
  promise: Promise<T>,
  label: string,
  ms = DB_QUERY_TIMEOUT_MS,
): Promise<T> {
  try {
    return await withQueryTimeout(promise, ms, label);
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("timed out after")
    ) {
      console.error(`[db] ${label} timed out — resetting connection pool`);
      await closeDb().catch(() => undefined);
    }
    throw err;
  }
}
