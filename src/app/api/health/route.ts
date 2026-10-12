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
import { dbQuery } from "@/lib/db/query";
import { getStorageBucket, getSupabaseAdmin } from "@/lib/storage/supabase";

export const runtime = "nodejs";

/** Keep publishing alive even if instrumentation.js never registered (common on some hosts). */
const PUBLISH_KICK_MS = 120_000;
let lastPublishKickAt = 0;

function kickDuePublishers() {
  const now = Date.now();
  if (now - lastPublishKickAt < PUBLISH_KICK_MS) return;
  lastPublishKickAt = now;

  void import("@/lib/process-instagram-due")
    .then(({ processInstagramDue }) => processInstagramDue())
    .catch((err) => {
      console.error(
        "[health/publish-kick/instagram]",
        err instanceof Error ? err.message : err,
      );
    });

  void import("@/lib/process-youtube-due")
    .then(({ processYouTubeDue }) => processYouTubeDue())
    .catch((err) => {
      console.error(
        "[health/publish-kick/youtube]",
        err instanceof Error ? err.message : err,
      );
    });
}

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
      await dbQuery(
        () => getDb().execute(sql`select 1 as ok`),
        "database ping",
        8_000,
      );
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

  // Railway (and most hosts) hit /api/health regularly — use that as a publish heartbeat.
  if (result.ok) {
    kickDuePublishers();
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
