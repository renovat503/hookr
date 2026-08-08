#!/usr/bin/env node
/**
 * Fix snapeat C1 YouTube schedule: restore missing exports, move past-due
 * failed posts to the end of the queue, and set the account posting goal.
 *
 *   node --env-file=.env.local scripts/fix-snapeat-youtube.mjs
 *   node --env-file=.env.local scripts/fix-snapeat-youtube.mjs --dry-run
 */
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const dryRun = process.argv.includes("--dry-run");
const CAMPAIGN_ID = "camp-1785433146686";
const ACCOUNT_ID =
  "yt-camp-1785433146686-UC13zvwQ3zut0GIrdH3S3HpA";
const RUN_FOLDERS = [
  "2026-07-30-124947-146686",
  "2026-07-31-171941-146686",
];
const YT_SLOT_TIMES_UTC = ["15:00", "23:00"]; // 9am / 5pm MDT

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

function slotFromParts(dateIso, time) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0));
}

function formatDateIso(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function nextYouTubeSlotsAfter(lastScheduledAt, count) {
  const slots = [];
  let cursor = new Date(lastScheduledAt);

  while (slots.length < count) {
    const dateIso = formatDateIso(cursor);
    const time = `${String(cursor.getUTCHours()).padStart(2, "0")}:${String(cursor.getUTCMinutes()).padStart(2, "0")}`;

    let dayIso = dateIso;
    let slotIndex = YT_SLOT_TIMES_UTC.indexOf(time);
    if (slotIndex < 0) {
      slotIndex = -1;
    }

    for (;;) {
      slotIndex += 1;
      if (slotIndex >= YT_SLOT_TIMES_UTC.length) {
        slotIndex = 0;
        const nextDay = slotFromParts(dayIso, "12:00");
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        dayIso = formatDateIso(nextDay);
      }
      const candidate = slotFromParts(dayIso, YT_SLOT_TIMES_UTC[slotIndex]);
      if (candidate.getTime() <= cursor.getTime()) continue;
      if (candidate.getTime() <= Date.now()) {
        cursor = candidate;
        continue;
      }
      slots.push(candidate);
      cursor = candidate;
      break;
    }
  }

  return slots;
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

async function restoreMissingExports(allFiles) {
  const missingPosts = await sql`
    SELECT export_id, export_name
    FROM youtube_scheduled_posts yp
    WHERE yp.campaign_id = ${CAMPAIGN_ID}
      AND yp.status IN ('scheduled', 'failed')
      AND NOT EXISTS (SELECT 1 FROM exports e WHERE e.id = yp.export_id)
  `;

  let inserted = 0;
  for (const post of missingPosts) {
    const slug = exportNameToSlug(post.export_name);
    const file = allFiles.find((candidate) =>
      candidate.name.includes(slug.slice(0, 20)),
    );
    if (!file) {
      throw new Error(`No storage file for ${post.export_id} (${post.export_name})`);
    }

    const demoName = parseDemoName(post.export_name);
    const createdAt = exportCreatedAt(post.export_id);

    if (dryRun) {
      console.log(`  would restore export ${post.export_id} -> ${file.name}`);
      inserted++;
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
        NULL, NULL, '', '', '', ${demoName},
        ${post.export_name.split(" + ")[0]?.trim() ?? ""},
        NULL, NULL, NULL, NULL, NULL,
        ${file.runFolder},
        ${CAMPAIGN_ID},
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
  }

  return inserted;
}

async function movePastDueToEnd() {
  const toMove = await sql`
    SELECT id, export_name, scheduled_at, status, error
    FROM youtube_scheduled_posts
    WHERE campaign_id = ${CAMPAIGN_ID}
      AND scheduled_at <= NOW()
      AND status IN ('scheduled', 'publishing', 'failed')
    ORDER BY scheduled_at ASC, id ASC
  `;

  if (!toMove.length) return 0;

  const [{ max_at: maxFuture }] = await sql`
    SELECT MAX(scheduled_at) AS max_at
    FROM youtube_scheduled_posts
    WHERE campaign_id = ${CAMPAIGN_ID}
      AND status IN ('scheduled', 'published')
      AND scheduled_at > NOW()
  `;

  const [{ overall }] = await sql`
    SELECT MAX(scheduled_at) AS overall
    FROM youtube_scheduled_posts
    WHERE campaign_id = ${CAMPAIGN_ID}
      AND status IN ('scheduled', 'published')
  `;

  const anchor = maxFuture ?? overall ?? new Date().toISOString();
  const newSlots = nextYouTubeSlotsAfter(anchor, toMove.length);

  for (let i = 0; i < toMove.length; i++) {
    const post = toMove[i];
    const slot = newSlots[i];
    console.log(
      `  ${post.id}: ${post.scheduled_at} (${post.status}) -> ${slot.toISOString()}`,
    );

    if (dryRun) continue;

    await sql`
      UPDATE youtube_scheduled_posts
      SET scheduled_at = ${slot.toISOString()},
          status = 'scheduled',
          error = NULL
      WHERE id = ${post.id}
    `;
  }

  return toMove.length;
}

async function setPostingGoal() {
  const goal = { postsPerDay: 2, slotTimes: ["09:00", "17:00"] };

  if (dryRun) {
    console.log(`  would set posting goal for ${ACCOUNT_ID}:`, goal);
    return;
  }

  await sql`
    UPDATE youtube_meta
    SET account_posting_goals = ${sql.json({ [ACCOUNT_ID]: goal })}
    WHERE id = ${CAMPAIGN_ID}
  `;
}

async function main() {
  console.log(
    dryRun
      ? "[dry-run] fixing snapeat C1 YouTube schedule..."
      : "Fixing snapeat C1 YouTube schedule...",
  );

  const allFiles = [];
  for (const run of RUN_FOLDERS) {
    const files = await listRunMp4s(run);
    console.log(`  ${run}: ${files.length} mp4`);
    allFiles.push(...files);
  }

  const restored = await restoreMissingExports(allFiles);
  console.log(
    dryRun
      ? `[dry-run] would restore ${restored} missing exports`
      : `Restored ${restored} missing exports`,
  );

  console.log("Moving past-due posts to end of queue:");
  const moved = await movePastDueToEnd();
  console.log(
    dryRun
      ? `[dry-run] would move ${moved} posts`
      : `Moved ${moved} posts to end of queue`,
  );

  await setPostingGoal();
  console.log(dryRun ? "[dry-run] would set posting goal" : "Set posting goal");
}

main()
  .then(() => sql.end())
  .catch((err) => {
    console.error(err);
    sql.end().finally(() => process.exit(1));
  });
