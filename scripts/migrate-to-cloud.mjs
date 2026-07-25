#!/usr/bin/env node
/**
 * One-time migration: local JSON + public/ media → Supabase Postgres + Storage.
 *
 * Usage:
 *   HOOKR_DATA_MODE=dual-write HOOKR_MEDIA_MODE=dual-write node scripts/migrate-to-cloud.mjs
 *   node scripts/migrate-to-cloud.mjs --dry-run
 */

import { readFile, readdir, stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const DATABASE_URL = required("DATABASE_URL");
const SUPABASE_URL = required("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "media";
const PUBLIC_BASE =
  process.env.SUPABASE_PUBLIC_MEDIA_BASE?.trim() ||
  `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}`;

const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function readJson(relativePath, fallback) {
  try {
    const raw = await readFile(path.join(root, relativePath), "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function toPublicUrl(relativePath) {
  if (relativePath.startsWith("http://") || relativePath.startsWith("https://")) {
    return relativePath;
  }
  const key = relativePath.replace(/^\/+/, "");
  return `${PUBLIC_BASE}/${key}`;
}

const MAX_UPLOAD_BYTES = Number(process.env.SUPABASE_MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024);
const skipped = [];

async function uploadLocalFile(relativeFromPublic, contentType) {
  const key = relativeFromPublic.replace(/^\/+/, "");
  const localPath = path.join(root, "public", key);

  let size = 0;
  try {
    size = (await stat(localPath)).size;
  } catch {
    console.warn(`  skip missing file: ${key}`);
    return null;
  }

  if (size > MAX_UPLOAD_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    console.warn(`  skip oversized file (${mb}MB > ${(MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0)}MB): ${key}`);
    skipped.push({ key, size, reason: "oversized" });
    return null;
  }

  if (dryRun) {
    console.log(`  would upload ${key} (${size} bytes)`);
    return toPublicUrl(key);
  }

  const buffer = await readFile(localPath);
  const { error } = await supabase.storage.from(BUCKET).upload(key, buffer, {
    contentType,
    upsert: true,
  });
  if (error) {
    console.warn(`  skip upload error for ${key}: ${error.message}`);
    skipped.push({ key, size, reason: error.message });
    return null;
  }
  console.log(`  uploaded ${key}`);
  return toPublicUrl(key);
}

async function walkPublicDir(subdir) {
  const base = path.join(root, "public", subdir);
  const files = [];

  async function walk(dir, prefix) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (!entry.name.startsWith(".")) {
        files.push(`/${rel.replace(/\\/g, "/")}`);
      }
    }
  }

  await walk(base, subdir.replace(/^\/+/, ""));
  return files;
}

function guessContentType(url) {
  const ext = path.extname(url).toLowerCase();
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".mp3") return "audio/mpeg";
  return "video/mp4";
}

async function rewriteMediaUrl(url) {
  if (!url || url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return uploadLocalFile(url, guessContentType(url));
}

async function migrateJson() {
  console.log("\n== Migrating JSON metadata to Postgres ==");

  const captionsFile = await readJson("data/captions.json", { captions: [] });
  const campaignsFile = await readJson("data/campaigns.json", { campaigns: [] });
  const libraryFile = await readJson("data/library.json", {
    hooks: [],
    demos: [],
    music: [],
    exports: [],
    characters: [],
    motions: [],
  });
  const instagramFile = await readJson("data/instagram.json", {
    accounts: [],
    scheduledPosts: [],
    publishedExportIds: [],
    accountLastPublishedAt: {},
    autoPostEnabled: true,
    autoPostIntervalHours: 5,
    apiRateLimitedUntil: null,
  });
  const settingsFile = await readJson("data/app-settings.json", {
    referenceMotionId: null,
  });

  for (const caption of captionsFile.captions ?? []) {
    if (dryRun) {
      console.log(`  would upsert caption ${caption.id}`);
      continue;
    }
    await sql`
      insert into captions (id, text, tags, created_at)
      values (${caption.id}, ${caption.text}, ${caption.tags ?? []}, ${caption.createdAt})
      on conflict (id) do update set text = excluded.text, tags = excluded.tags
    `;
  }

  for (const campaign of campaignsFile.campaigns ?? []) {
    if (dryRun) {
      console.log(`  would upsert campaign ${campaign.id}`);
      continue;
    }
    await sql`
      insert into campaigns (
        id, name, status, hook_ids, demo_ids, caption_ids, use_captions,
        audio_mode, music_id, music_volume, random_format,
        borrow_from_campaign_id, borrow_asset_kind, created_at, updated_at
      ) values (
        ${campaign.id}, ${campaign.name}, ${campaign.status ?? "open"},
        ${campaign.hookIds ?? []}, ${campaign.demoIds ?? []},
        ${campaign.captionIds ?? []}, ${Boolean(campaign.useCaptions)},
        ${campaign.audioMode ?? "none"}, ${campaign.musicId ?? null},
        ${campaign.musicVolume ?? 85}, ${campaign.randomFormat !== false},
        ${campaign.borrowFromCampaignId ?? null}, ${campaign.borrowAssetKind ?? null},
        ${campaign.createdAt}, ${campaign.updatedAt}
      )
      on conflict (id) do update set
        name = excluded.name,
        status = excluded.status,
        hook_ids = excluded.hook_ids,
        demo_ids = excluded.demo_ids,
        caption_ids = excluded.caption_ids,
        updated_at = excluded.updated_at
    `;
  }

  for (const hook of libraryFile.hooks ?? []) {
    hook.url = (await rewriteMediaUrl(hook.url)) ?? hook.url;
    hook.rawUrl = hook.rawUrl
      ? (await rewriteMediaUrl(hook.rawUrl)) ?? hook.rawUrl
      : null;
    if (dryRun) {
      console.log(`  would upsert hook ${hook.id}`);
      continue;
    }
    await sql`
      insert into hooks (
        id, url, raw_url, action_prompt, overlay_text, overlay_style,
        character_source, character_preset_id, duration_seconds, overlay_burned,
        source_hook_id, reference_motion_id, campaign_id, copied_from_hook_id,
        copied_from_campaign_id, created_at
      ) values (
        ${hook.id}, ${hook.url}, ${hook.rawUrl}, ${hook.actionPrompt ?? ""},
        ${hook.overlayText ?? ""}, ${hook.overlayStyle ?? null},
        ${hook.characterSource}, ${hook.characterPresetId ?? null},
        ${hook.durationSeconds ?? 0}, ${Boolean(hook.overlayBurned)},
        ${hook.sourceHookId ?? null}, ${hook.referenceMotionId ?? null},
        ${hook.campaignId ?? null}, ${hook.copiedFromHookId ?? null},
        ${hook.copiedFromCampaignId ?? null}, ${hook.createdAt}
      )
      on conflict (id) do update set url = excluded.url, raw_url = excluded.raw_url
    `;
  }

  for (const demo of libraryFile.demos ?? []) {
    demo.url = (await rewriteMediaUrl(demo.url)) ?? demo.url;
    if (!dryRun) {
      await sql`
        insert into demos (id, name, url, duration_seconds, uploaded_at)
        values (${demo.id}, ${demo.name}, ${demo.url}, ${demo.durationSeconds ?? 0}, ${demo.uploadedAt})
        on conflict (id) do update set url = excluded.url
      `;
    }
  }

  for (const motion of libraryFile.motions ?? []) {
    motion.url = (await rewriteMediaUrl(motion.url)) ?? motion.url;
    if (!dryRun) {
      await sql`
        insert into motions (id, name, url, action_prompt, duration_seconds, source_hook_id, uploaded_at)
        values (${motion.id}, ${motion.name}, ${motion.url}, ${motion.actionPrompt ?? ""},
          ${motion.durationSeconds ?? 0}, ${motion.sourceHookId ?? null}, ${motion.uploadedAt})
        on conflict (id) do update set url = excluded.url
      `;
    }
  }

  for (const track of libraryFile.music ?? []) {
    track.url = (await rewriteMediaUrl(track.url)) ?? track.url;
    if (!dryRun) {
      await sql`
        insert into music (id, name, url, duration_seconds, uploaded_at)
        values (${track.id}, ${track.name}, ${track.url}, ${track.durationSeconds ?? 0}, ${track.uploadedAt})
        on conflict (id) do update set url = excluded.url
      `;
    }
  }

  for (const character of libraryFile.characters ?? []) {
    character.url = (await rewriteMediaUrl(character.url)) ?? character.url;
    if (!dryRun) {
      await sql`
        insert into characters (id, name, url, uploaded_at)
        values (${character.id}, ${character.name}, ${character.url}, ${character.uploadedAt})
        on conflict (id) do update set url = excluded.url
      `;
    }
  }

  for (const exp of libraryFile.exports ?? []) {
    exp.url = (await rewriteMediaUrl(exp.url)) ?? exp.url;
    exp.hookUrl = (await rewriteMediaUrl(exp.hookUrl)) ?? exp.hookUrl;
    exp.demoUrl = (await rewriteMediaUrl(exp.demoUrl)) ?? exp.demoUrl;
    if (!dryRun) {
      await sql`
        insert into exports (
          id, name, url, hook_id, demo_id, hook_url, demo_url, hook_action_prompt,
          demo_name, overlay_text, caption_hash, music_id, music_name, music_volume,
          variation, run_folder, campaign_id, status, created_at
        ) values (
          ${exp.id}, ${exp.name}, ${exp.url}, ${exp.hookId ?? null}, ${exp.demoId ?? null},
          ${exp.hookUrl ?? ""}, ${exp.demoUrl ?? ""}, ${exp.hookActionPrompt ?? ""},
          ${exp.demoName ?? ""}, ${exp.overlayText ?? ""}, ${exp.captionHash ?? null},
          ${exp.musicId ?? null}, ${exp.musicName ?? null}, ${exp.musicVolume ?? null},
          ${exp.variation ?? null}, ${exp.runFolder ?? null},
          ${exp.campaignId ?? null}, ${exp.status ?? "ready"}, ${exp.createdAt}
        )
        on conflict (id) do update set url = excluded.url
      `;
    }
  }

  if (!dryRun) {
    await sql`
      insert into app_settings (id, reference_motion_id)
      values ('default', ${settingsFile.referenceMotionId ?? null})
      on conflict (id) do update set reference_motion_id = excluded.reference_motion_id
    `;
  }

  for (const account of instagramFile.accounts ?? []) {
    if (!dryRun) {
      await sql`
        insert into instagram_accounts (
          id, ig_user_id, username, profile_picture_url, page_id, page_name,
          access_token, connected_at, token_expires_at
        ) values (
          ${account.id}, ${account.igUserId}, ${account.username},
          ${account.profilePictureUrl ?? null}, ${account.pageId}, ${account.pageName},
          ${account.accessToken}, ${account.connectedAt}, ${account.tokenExpiresAt ?? null}
        )
        on conflict (id) do update set access_token = excluded.access_token
      `;
    }
  }

  for (const post of instagramFile.scheduledPosts ?? []) {
    if (!dryRun) {
      await sql`
        insert into scheduled_posts (
          id, account_id, export_id, export_name, caption, scheduled_at, status,
          created_at, published_at, published_media_id, error
        ) values (
          ${post.id}, ${post.accountId}, ${post.exportId}, ${post.exportName ?? null},
          ${post.caption ?? ""}, ${post.scheduledAt}, ${post.status}, ${post.createdAt},
          ${post.publishedAt ?? null}, ${post.publishedMediaId ?? null}, ${post.error ?? null}
        )
        on conflict (id) do nothing
      `;
    }
  }

  if (!dryRun) {
    await sql`
      insert into instagram_meta (
        id, published_export_ids, account_last_published_at,
        auto_post_enabled, auto_post_interval_hours, api_rate_limited_until
      ) values (
        'default',
        ${instagramFile.publishedExportIds ?? []},
        ${instagramFile.accountLastPublishedAt ?? {}},
        ${instagramFile.autoPostEnabled !== false},
        ${instagramFile.autoPostIntervalHours ?? 5},
        ${instagramFile.apiRateLimitedUntil ?? null}
      )
      on conflict (id) do update set
        published_export_ids = excluded.published_export_ids,
        account_last_published_at = excluded.account_last_published_at,
        auto_post_enabled = excluded.auto_post_enabled,
        auto_post_interval_hours = excluded.auto_post_interval_hours,
        api_rate_limited_until = excluded.api_rate_limited_until
    `;
  }

  console.log("Metadata migration complete.");
}

async function migrateOrphanMedia() {
  console.log("\n== Uploading media files ==");
  const dirs = ["uploads", "generated", "exports"];
  for (const dir of dirs) {
    const files = await walkPublicDir(dir);
    console.log(`Found ${files.length} files under public/${dir}`);
    for (const file of files) {
      await uploadLocalFile(file, guessContentType(file));
    }
  }
}

async function main() {
  console.log(dryRun ? "DRY RUN — no writes" : "Starting cloud migration…");
  await migrateJson();
  await migrateOrphanMedia();
  await sql.end();
  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length} file(s):`);
    for (const item of skipped) {
      console.log(`  - ${item.key} (${item.reason})`);
    }
    console.log("\nOversized demos stay on local disk; dual-write mode will still serve them locally.");
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
