import { sql } from "drizzle-orm";
import { getDataMode } from "@/lib/config/storage-mode";
import { getDb } from "@/lib/db/client";

export async function ensureInstagramMeta(): Promise<void> {
  const mode = getDataMode();
  if (mode !== "dual-write" && mode !== "postgres-only") return;
  if (!process.env.DATABASE_URL?.trim()) return;

  try {
    await getDb().execute(sql`set lock_timeout = '5s'`);
    await getDb().execute(sql`set statement_timeout = '30s'`);
    await getDb().execute(sql`
      create table if not exists instagram_meta (
        id text primary key default 'default',
        published_export_ids jsonb not null default '[]'::jsonb,
        account_last_published_at jsonb not null default '{}'::jsonb,
        auto_post_enabled boolean not null default true,
        auto_post_interval_hours integer not null default 5,
        api_rate_limited_until timestamptz
      )
    `);
    await getDb().execute(sql`
      insert into instagram_meta (id)
      values ('default')
      on conflict (id) do nothing
    `);
    await getDb().execute(sql`
      alter table scheduled_posts
      add column if not exists source text not null default 'manual'
    `);
    await getDb().execute(sql`
      alter table scheduled_posts
      add column if not exists queue_position integer
    `);
    await getDb().execute(sql`
      alter table instagram_meta
      add column if not exists account_posting_goals jsonb not null default '{}'::jsonb
    `);
    console.log("[db] instagram_meta ready.");
  } catch (err) {
    console.warn(
      "[db] ensure instagram_meta skipped:",
      err instanceof Error ? err.message : err,
    );
  }
}
