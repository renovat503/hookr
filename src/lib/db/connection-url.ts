/**
 * Resolve the Postgres URL for Supabase on PaaS hosts (Railway, Render, etc.).
 * Direct db.*.supabase.co:5432 is often IPv6-only; the regional pooler works over IPv4.
 */
export function resolveDatabaseUrl(): string {
  const explicitPooler = process.env.DATABASE_POOLER_URL?.trim();
  if (explicitPooler) return explicitPooler;

  const direct = process.env.DATABASE_URL?.trim();
  if (!direct) {
    throw new Error("DATABASE_URL is required when HOOKR_DATA_MODE is enabled.");
  }

  if (process.env.NODE_ENV !== "production") return direct;

  const pooler = buildSupabasePoolerUrl(direct);
  if (pooler) return pooler;

  return rewriteSupabasePort6543(direct);
}

export function isSupabasePoolerUrl(url: string): boolean {
  return /pooler\.supabase\.com:6543/i.test(url) || /supabase\.co:6543/i.test(url);
}

function extractProjectRef(direct: string): string | null {
  const fromEnv = process.env.SUPABASE_URL?.trim().match(
    /^https:\/\/([^.]+)\.supabase\.co/i,
  )?.[1];
  if (fromEnv) return fromEnv;

  try {
    const parsed = new URL(direct.replace(/^postgresql:/, "http:"));
    const fromHost = parsed.hostname.match(/^db\.([^.]+)\.supabase\.co$/i)?.[1];
    return fromHost ?? null;
  } catch {
    return null;
  }
}

function buildSupabasePoolerUrl(direct: string): string | null {
  const ref = extractProjectRef(direct);
  if (!ref) return null;

  try {
    const parsed = new URL(direct.replace(/^postgresql:/, "http:"));
    const password = parsed.password ? decodeURIComponent(parsed.password) : "";
    if (!password) return null;

    const region =
      process.env.SUPABASE_DB_REGION?.trim() ||
      process.env.SUPABASE_REGION?.trim() ||
      "us-east-1";

    const user = `postgres.${ref}`;
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:6543/postgres`;
  } catch {
    return null;
  }
}

function rewriteSupabasePort6543(direct: string): string {
  try {
    const parsed = new URL(direct.replace(/^postgresql:/, "http:"));
    const isSupabaseDirect =
      /supabase\.co$/i.test(parsed.hostname) &&
      (!parsed.port || parsed.port === "5432");

    if (!isSupabaseDirect) return direct;

    parsed.port = "6543";
    const user = decodeURIComponent(parsed.username);
    const password = parsed.password
      ? decodeURIComponent(parsed.password)
      : "";
    const auth = password
      ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`
      : `${encodeURIComponent(user)}@`;
    return `postgresql://${auth}${parsed.hostname}:${parsed.port}${parsed.pathname}${parsed.search}`;
  } catch {
    return direct;
  }
}

export function formatPgError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const parts = [err.message];
  let current: unknown = err.cause;
  let depth = 0;
  while (current instanceof Error && depth < 4) {
    if (current.message && !parts.includes(current.message)) {
      parts.push(current.message);
    }
    current = current.cause;
    depth += 1;
  }
  return parts.join(" | ");
}
