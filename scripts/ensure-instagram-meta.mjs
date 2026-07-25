import postgres from "postgres";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  process.exit(0);
}

const needsSsl =
  /supabase\.(co|com)/i.test(url) ||
  process.env.DATABASE_SSL === "require" ||
  process.env.NODE_ENV === "production";

const sql = postgres(url, {
  prepare: false,
  max: 1,
  connect_timeout: 15,
  ...(needsSsl ? { ssl: "require" } : {}),
});

try {
  await sql`
    create table if not exists instagram_meta (
      id text primary key default 'default',
      published_export_ids jsonb not null default '[]'::jsonb,
      account_last_published_at jsonb not null default '{}'::jsonb,
      auto_post_enabled boolean not null default true,
      auto_post_interval_hours integer not null default 5,
      api_rate_limited_until timestamptz
    )
  `;
  await sql`
    insert into instagram_meta (id)
    values ('default')
    on conflict (id) do nothing
  `;
  console.log("[db] instagram_meta ready.");
} catch (err) {
  console.error(
    "[db] ensure instagram_meta failed:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
} finally {
  await sql.end({ timeout: 2 });
}
