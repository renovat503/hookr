import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import {
  getDataMode,
  getMediaMode,
  isCloudConfigured,
  usesPostgresRead,
  usesSupabaseRead,
} from "@/lib/config/storage-mode";
import { formatPgError, isSupabasePoolerUrl, resolveDatabaseUrl } from "@/lib/db/connection-url";
import { getDb } from "@/lib/db/client";
import { getStorageBucket, getSupabaseAdmin } from "@/lib/storage/supabase";

export const runtime = "nodejs";

export async function GET() {
  const result = {
    ok: true,
    dataMode: getDataMode(),
    mediaMode: getMediaMode(),
    cloudConfigured: isCloudConfigured(),
    database: {
      enabled: usesPostgresRead(),
      ok: false as boolean,
      connection: null as string | null,
      error: null as string | null,
    },
    supabase: {
      enabled: usesSupabaseRead(),
      ok: false as boolean,
      bucket: getStorageBucket(),
      error: null as string | null,
    },
  };

  if (usesPostgresRead()) {
    try {
      const url = resolveDatabaseUrl();
      result.database.connection = isSupabasePoolerUrl(url) ? "pooler" : "direct";
      await getDb().execute(sql`select 1 as ok`);
      result.database.ok = true;
    } catch (err) {
      result.ok = false;
      result.database.error = formatPgError(err);
    }
  } else {
    result.database.error = "Postgres reads disabled (HOOKR_DATA_MODE=off).";
  }

  if (usesSupabaseRead()) {
    try {
      const supabase = getSupabaseAdmin();
      const { error } = await supabase.storage.from(getStorageBucket()).list("", {
        limit: 1,
      });
      if (error) throw new Error(error.message);
      result.supabase.ok = true;
    } catch (err) {
      result.ok = false;
      result.supabase.error =
        err instanceof Error ? err.message : "Supabase storage check failed.";
    }
  } else {
    result.supabase.error = "Supabase reads disabled (HOOKR_MEDIA_MODE=local).";
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
