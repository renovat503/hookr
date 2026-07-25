import { closeDb } from "@/lib/db/client";
import { withQueryTimeout } from "@/lib/db/query-timeout";

export const DB_QUERY_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 2;

let poolReset: Promise<void> | null = null;

function isTransientDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("connection_ended") ||
    msg.includes("connection terminated") ||
    msg.includes("connection closed") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("socket hang up") ||
    msg.includes("timed out after") ||
    msg.includes("cannot acquire connection") ||
    msg.includes("connection lost")
  );
}

async function resetDbPool(): Promise<void> {
  if (!poolReset) {
    poolReset = closeDb().finally(() => {
      poolReset = null;
    });
  }
  await poolReset;
}

function retryDelayMs(attempt: number): number {
  return attempt * 250;
}

export async function dbQuery<T>(
  run: () => Promise<T>,
  label: string,
  ms = DB_QUERY_TIMEOUT_MS,
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await withQueryTimeout(run(), ms, label);
    } catch (err) {
      lastErr = err;
      const retry = isTransientDbError(err) && attempt < MAX_ATTEMPTS;
      if (retry) {
        console.warn(
          `[db] ${label} failed (attempt ${attempt}/${MAX_ATTEMPTS}), resetting pool`,
          err instanceof Error ? err.message : err,
        );
        await resetDbPool();
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}
