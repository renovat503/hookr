export type DataMode = "off" | "dual-write" | "postgres-only";
export type MediaMode = "local" | "dual-write" | "supabase-only";

function parseDataMode(raw: string | undefined): DataMode {
  if (raw === "dual-write" || raw === "postgres-only") return raw;
  return "off";
}

function parseMediaMode(raw: string | undefined): MediaMode {
  if (raw === "dual-write" || raw === "supabase-only") return raw;
  return "local";
}

export function getDataMode(): DataMode {
  return parseDataMode(process.env.HOOKR_DATA_MODE);
}

export function getMediaMode(): MediaMode {
  return parseMediaMode(process.env.HOOKR_MEDIA_MODE);
}

export function usesPostgresRead(): boolean {
  return getDataMode() !== "off";
}

export function usesPostgresWrite(): boolean {
  const mode = getDataMode();
  return mode === "dual-write" || mode === "postgres-only";
}

export function usesJsonWrite(): boolean {
  return getDataMode() !== "postgres-only";
}

export function usesSupabaseRead(): boolean {
  return getMediaMode() !== "local";
}

export function usesSupabaseWrite(): boolean {
  const mode = getMediaMode();
  return mode === "dual-write" || mode === "supabase-only";
}

export function usesLocalMediaWrite(): boolean {
  return getMediaMode() !== "supabase-only";
}

export function isCloudConfigured(): boolean {
  return Boolean(
    process.env.DATABASE_URL?.trim() &&
      process.env.SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}
