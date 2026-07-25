/**
 * Prefer Supabase's transaction pooler (port 6543) in production.
 * Railway and other PaaS hosts often cannot reach the direct IPv6 endpoint on 5432.
 */
export function resolveDatabaseUrl(): string {
  const pooler = process.env.DATABASE_POOLER_URL?.trim();
  if (pooler) return pooler;

  const direct = process.env.DATABASE_URL?.trim();
  if (!direct) {
    throw new Error("DATABASE_URL is required when HOOKR_DATA_MODE is enabled.");
  }

  if (process.env.NODE_ENV !== "production") return direct;

  try {
    const parsed = new URL(direct.replace(/^postgresql:/, "http:"));
    const isSupabaseDirect =
      /supabase\.co$/i.test(parsed.hostname) &&
      (!parsed.port || parsed.port === "5432");

    if (isSupabaseDirect) {
      parsed.port = "6543";
      const user = decodeURIComponent(parsed.username);
      const password = parsed.password
        ? decodeURIComponent(parsed.password)
        : "";
      const auth = password
        ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`
        : `${encodeURIComponent(user)}@`;
      return `postgresql://${auth}${parsed.hostname}:${parsed.port}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Fall back to the raw env value.
  }

  return direct;
}

export function isSupabasePoolerUrl(url: string): boolean {
  return /supabase\.co:6543/i.test(url);
}
