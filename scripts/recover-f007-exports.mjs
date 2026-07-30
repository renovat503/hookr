#!/usr/bin/env node
/**
 * Restore F007 export library rows from Supabase run folders and re-enable
 * orphaned Instagram schedules that lost their export records.
 *
 *   node --env-file=.env.local scripts/recover-f007-exports.mjs
 *   node --env-file=.env.local scripts/recover-f007-exports.mjs --dry-run
 */
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const dryRun = process.argv.includes("--dry-run");
const F007_CAMPAIGN_ID = "camp-1785089408845";
const ORPHANED_EXPORT_ERROR =
  "Export no longer in library — re-produce and schedule again.";
const F007_RUN_FOLDERS = [
  "2026-07-26-150838-408845",
  "2026-07-26-151652-408845",
  "2026-07-26-210438-408845",
  "2026-07-26-export-test2",
];

function required(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function slugifyCaption(text, max = 36) {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return slug || "caption";
}

function exportNameToSlug(exportName) {
  const captionPart = exportName.split(" + ")[0]?.trim() || exportName;
  return slugifyCaption(captionPart).slice(0, 40);
}

function parseDemoName(exportName) {
  const parts = exportName.split(" + ");
  if (parts.length < 2) return "Demo clip";
  const rest = parts.slice(1).join(" + ");
  const demo = rest.split(" · ")[0]?.trim();
  return demo || "Demo clip";
}

function exportCreatedAt(exportId) {
  const ts = exportId.replace(/^export-/, "");
  const n = Number(ts);
  if (Number.isFinite(n) && n > 1_600_000_000_000) {
    return new Date(n).toISOString();
  }
  return new Date().toISOString();
}

const DATABASE_URL = required("DATABASE_URL");
const SUPABASE_URL = required("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "media";
const PUBLIC_BASE =
  process.env.SUPABASE_PUBLIC_MEDIA_BASE?.trim() ||
  `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}`;

const sql = postgres(DATABASE_URL, { prepare: false, max: 1, ssl: "require" });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function listRunMp4s(runFolder) {
  const files = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(`exports/runs/${runFolder}`, { limit: 100, offset });
    if (error) throw new Error(`list ${runFolder}: ${error.message}`);
    if (!data?.length) break;
    for (const file of data) {
      if (!file.name.endsWith(".mp4")) continue;
      const key = `exports/runs/${runFolder}/${file.name}`;
      files.push({
        runFolder,
        name: file.name,
        key,
        url: `${PUBLIC_BASE}/${key}`,
      });
    }
    if (data.length < 100) break;
    offset += 100;
  }
  return files;
}

async function ensureF007InstagramAccount(sourceAccountId) {
  const rows = await sql`
    SELECT * FROM instagram_accounts WHERE id = ${sourceAccountId} LIMIT 1
  `;
  const source = rows[0];
  if (!source) throw new Error(`Instagram account not found: ${sourceAccountId}`);

  const targetId = `ig-${F007_CAMPAIGN_ID}-${source.ig_user_id}`;
  const existing = await sql`
    SELECT id FROM instagram_accounts WHERE id = ${targetId} LIMIT 1
  `;
  if (existing.length) return targetId;

  if (dryRun) {
    console.log(`  would clone instagram account -> ${targetId}`);
    return targetId;
  }

  await sql`
    INSERT INTO instagram_accounts (
      id, campaign_id, ig_user_id, username, profile_picture_url,
      page_id, page_name, access_token, connected_at, token_expires_at
    ) VALUES (
      ${targetId},
      ${F007_CAMPAIGN_ID},
      ${source.ig_user_id},
      ${source.username},
      ${source.profile_picture_url},
      ${source.page_id},
      ${source.page_name},
      ${source.access_token},
      ${source.connected_at},
      ${source.token_expires_at}
    )
  `;
  return targetId;
}

async function main() {
  console.log(dryRun ? "[dry-run] recovering F007 exports..." : "Recovering F007 exports...");

  const allFiles = [];
  for (const run of F007_RUN_FOLDERS) {
    const files = await listRunMp4s(run);
    console.log(`  ${run}: ${files.length} mp4`);
    allFiles.push(...files);
  }

  const posts = await sql`
    SELECT id, export_id, export_name, account_id, campaign_id
    FROM scheduled_posts
    WHERE status = 'failed' AND error = ${ORPHANED_EXPORT_ERROR}
    ORDER BY export_id
  `;

  if (posts.length !== allFiles.length) {
    console.warn(
      `Warning: ${posts.length} failed posts vs ${allFiles.length} storage files`,
    );
  }

  const usedFiles = new Set();
  const pairs = [];
  const unmatched = [];

  for (const post of posts) {
    const slug = exportNameToSlug(post.export_name);
    const file = allFiles.find(
      (candidate) =>
        !usedFiles.has(candidate.key) &&
        candidate.name.includes(slug.slice(0, 20)),
    );
    if (!file) {
      unmatched.push(post);
      continue;
    }
    usedFiles.add(file.key);
    pairs.push({ post, file });
  }

  if (unmatched.length) {
    console.error("Unmatched posts:", unmatched.slice(0, 5));
    throw new Error(`${unmatched.length} scheduled posts could not be matched`);
  }

  const sourceAccountId = posts[0]?.account_id;
  if (!sourceAccountId) throw new Error("No source Instagram account on failed posts");
  const f007AccountId = await ensureF007InstagramAccount(sourceAccountId);

  let inserted = 0;
  let updated = 0;

  for (const { post, file } of pairs) {
    const demoName = parseDemoName(post.export_name);
    const createdAt = exportCreatedAt(post.export_id);

    if (dryRun) {
      inserted++;
      updated++;
      continue;
    }

    await sql`
      INSERT INTO exports (
        id, name, url, hook_id, demo_id, hook_url, demo_url,
        hook_action_prompt, demo_name, overlay_text, caption_hash,
        music_id, music_name, music_volume, variation, run_folder,
        campaign_id, status, created_at
      ) VALUES (
        ${post.export_id},
        ${post.export_name},
        ${file.url},
        NULL,
        NULL,
        '',
        '',
        '',
        ${demoName},
        ${post.export_name.split(" + ")[0]?.trim() ?? ""},
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        ${file.runFolder},
        ${F007_CAMPAIGN_ID},
        'ready',
        ${createdAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        url = EXCLUDED.url,
        demo_name = EXCLUDED.demo_name,
        run_folder = EXCLUDED.run_folder,
        campaign_id = EXCLUDED.campaign_id,
        status = 'ready'
    `;
    inserted++;

    await sql`
      UPDATE scheduled_posts
      SET
        campaign_id = ${F007_CAMPAIGN_ID},
        account_id = ${f007AccountId},
        status = 'scheduled',
        error = NULL
      WHERE id = ${post.id}
    `;
    updated++;
  }

  console.log(
    dryRun
      ? `[dry-run] would insert ${inserted} exports and restore ${updated} schedules on F007`
      : `Inserted ${inserted} exports and restored ${updated} schedules on F007`,
  );
}

main()
  .then(() => sql.end())
  .catch((err) => {
    console.error(err);
    sql.end().finally(() => process.exit(1));
  });
