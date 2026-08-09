#!/usr/bin/env node
/**
 * Restore F007 (Getflippr) exports from Supabase storage, dedupe YouTube
 * schedules, reset orphaned failed posts, and push past-due items to the
 * end of each queue.
 *
 *   node --env-file=.env.local scripts/recover-f007-all.mjs
 *   node --env-file=.env.local scripts/recover-f007-all.mjs --dry-run
 */
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const dryRun = process.argv.includes("--dry-run");
const CAMPAIGN_ID = "camp-1785089408845";
const RUN_FOLDERS = [
  "2026-07-26-150838-408845",
  "2026-07-26-151652-408845",
  "2026-07-26-210438-408845",
  "2026-07-26-export-test2",
];
const IG_SLOT_TIMES_UTC = [
  "00:30",
  "03:30",
  "12:00",
  "15:00",
  "18:00",
  "21:00",
];
const YT_SLOT_TIMES_UTC = ["15:00", "23:00"];

const MISSING_ERRORS = [
  "Finished video missing.",
  "Export no longer in library — re-produce and schedule again.",
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
  return rest.split(" · ")[0]?.trim() || "Demo clip";
}

function exportCreatedAt(exportId) {
  const ts = exportId.replace(/^export-/, "");
  const n = Number(ts);
  if (Number.isFinite(n) && n > 1_600_000_000_000) {
    return new Date(n).toISOString();
  }
  return new Date().toISOString();
}

function formatDateIso(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function slotFromParts(dateIso, time) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0));
}

function nextSlotsAfter(lastScheduledAt, count, slotTimesUtc) {
  const slots = [];
  let cursor = new Date(lastScheduledAt);

  while (slots.length < count) {
    let dayIso = formatDateIso(cursor);
    const time = `${String(cursor.getUTCHours()).padStart(2, "0")}:${String(
      cursor.getUTCMinutes(),
    ).padStart(2, "0")}`;
    let slotIndex = slotTimesUtc.indexOf(time);
    if (slotIndex < 0) slotIndex = -1;

    for (;;) {
      slotIndex += 1;
      if (slotIndex >= slotTimesUtc.length) {
        slotIndex = 0;
        const nextDay = slotFromParts(dayIso, "12:00");
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        dayIso = formatDateIso(nextDay);
      }
      const candidate = slotFromParts(dayIso, slotTimesUtc[slotIndex]);
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

async function restoreExports(allFiles) {
  const need = await sql`
    SELECT DISTINCT export_id, export_name FROM (
      SELECT export_id, export_name FROM youtube_scheduled_posts
      WHERE campaign_id = ${CAMPAIGN_ID}
      UNION
      SELECT export_id, export_name FROM scheduled_posts
      WHERE campaign_id = ${CAMPAIGN_ID}
    ) t
    WHERE export_id IS NOT NULL
    ORDER BY export_id
  `;

  const used = new Set();
  const pairs = [];
  const unmatched = [];

  for (const post of need) {
    const slug = exportNameToSlug(post.export_name || "");
    const file = allFiles.find(
      (candidate) =>
        !used.has(candidate.key) &&
        candidate.name.includes(slug.slice(0, 20)),
    );
    if (!file) {
      unmatched.push(post);
      continue;
    }
    used.add(file.key);
    pairs.push({ post, file });
  }

  if (unmatched.length) {
    console.error("Unmatched sample:", unmatched.slice(0, 5));
    throw new Error(`${unmatched.length} exports could not be matched to storage`);
  }

  let inserted = 0;
  for (const { post, file } of pairs) {
    if (dryRun) {
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
        NULL, NULL, '', '', '',
        ${parseDemoName(post.export_name || "")},
        ${(post.export_name || "").split(" + ")[0]?.trim() ?? ""},
        NULL, NULL, NULL, NULL, NULL,
        ${file.runFolder},
        ${CAMPAIGN_ID},
        'ready',
        ${exportCreatedAt(post.export_id)}
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

async function dedupeYouTube() {
  const dups = await sql`
    SELECT export_id
    FROM youtube_scheduled_posts
    WHERE campaign_id = ${CAMPAIGN_ID}
    GROUP BY export_id
    HAVING COUNT(*) > 1
  `;

  let cancelled = 0;
  for (const { export_id } of dups) {
    const rows = await sql`
      SELECT id, status, scheduled_at, youtube_video_id
      FROM youtube_scheduled_posts
      WHERE campaign_id = ${CAMPAIGN_ID} AND export_id = ${export_id}
      ORDER BY
        CASE
          WHEN status = 'published' THEN 0
          WHEN youtube_video_id IS NOT NULL THEN 1
          WHEN status = 'scheduled' THEN 2
          WHEN status = 'publishing' THEN 3
          WHEN status = 'failed' THEN 4
          ELSE 5
        END,
        scheduled_at ASC,
        id ASC
    `;
    const keep = rows[0];
    const drop = rows.slice(1);
    for (const row of drop) {
      if (row.status === "published") continue;
      console.log(`  cancel duplicate ${row.id} (keep ${keep.id})`);
      if (dryRun) {
        cancelled++;
        continue;
      }
      await sql`
        UPDATE youtube_scheduled_posts
        SET status = 'cancelled', error = 'Duplicate schedule removed'
        WHERE id = ${row.id}
      `;
      cancelled++;
    }
  }
  return cancelled;
}

async function resetMissingPosts(table) {
  const isYt = table === "youtube_scheduled_posts";
  const updated = dryRun
    ? await sql`
        SELECT COUNT(*)::int AS c FROM ${sql(table)}
        WHERE campaign_id = ${CAMPAIGN_ID}
          AND (
            error = ANY(${MISSING_ERRORS})
            OR (status = 'publishing' AND scheduled_at <= NOW())
          )
      `
    : null;

  if (dryRun) return updated[0].c;

  if (isYt) {
    const result = await sql`
      UPDATE youtube_scheduled_posts
      SET status = 'scheduled', error = NULL
      WHERE campaign_id = ${CAMPAIGN_ID}
        AND (
          error = ANY(${MISSING_ERRORS})
          OR (status = 'publishing' AND scheduled_at <= NOW())
        )
      RETURNING id
    `;
    return result.length;
  }

  const result = await sql`
    UPDATE scheduled_posts
    SET status = 'scheduled', error = NULL
    WHERE campaign_id = ${CAMPAIGN_ID}
      AND (
        error = ANY(${MISSING_ERRORS})
        OR (status = 'publishing' AND scheduled_at <= NOW())
      )
    RETURNING id
  `;
  return result.length;
}

async function movePastDue(table, slotTimesUtc) {
  const isYt = table === "youtube_scheduled_posts";
  const toMove = isYt
    ? await sql`
        SELECT id, scheduled_at, status
        FROM youtube_scheduled_posts
        WHERE campaign_id = ${CAMPAIGN_ID}
          AND scheduled_at <= NOW()
          AND status IN ('scheduled', 'publishing', 'failed')
          AND (error IS NULL OR error <> 'The user has exceeded the number of videos they may upload.')
        ORDER BY scheduled_at ASC, id ASC
      `
    : await sql`
        SELECT id, scheduled_at, status
        FROM scheduled_posts
        WHERE campaign_id = ${CAMPAIGN_ID}
          AND scheduled_at <= NOW()
          AND status IN ('scheduled', 'publishing', 'failed')
        ORDER BY scheduled_at ASC, id ASC
      `;

  if (!toMove.length) return 0;

  const [{ max_at }] = isYt
    ? await sql`
        SELECT MAX(scheduled_at) AS max_at FROM youtube_scheduled_posts
        WHERE campaign_id = ${CAMPAIGN_ID}
          AND status IN ('scheduled', 'published')
          AND scheduled_at > NOW()
      `
    : await sql`
        SELECT MAX(scheduled_at) AS max_at FROM scheduled_posts
        WHERE campaign_id = ${CAMPAIGN_ID}
          AND status IN ('scheduled', 'published')
          AND scheduled_at > NOW()
      `;

  const [{ overall }] = isYt
    ? await sql`
        SELECT MAX(scheduled_at) AS overall FROM youtube_scheduled_posts
        WHERE campaign_id = ${CAMPAIGN_ID}
          AND status IN ('scheduled', 'published')
      `
    : await sql`
        SELECT MAX(scheduled_at) AS overall FROM scheduled_posts
        WHERE campaign_id = ${CAMPAIGN_ID}
          AND status IN ('scheduled', 'published')
      `;

  const slots = nextSlotsAfter(
    max_at ?? overall ?? new Date().toISOString(),
    toMove.length,
    slotTimesUtc,
  );

  for (let i = 0; i < toMove.length; i++) {
    const post = toMove[i];
    const slot = slots[i];
    console.log(
      `  ${table} ${post.id}: ${post.scheduled_at} (${post.status}) -> ${slot.toISOString()}`,
    );
    if (dryRun) continue;
    if (isYt) {
      await sql`
        UPDATE youtube_scheduled_posts
        SET scheduled_at = ${slot.toISOString()}, status = 'scheduled', error = NULL
        WHERE id = ${post.id}
      `;
    } else {
      await sql`
        UPDATE scheduled_posts
        SET scheduled_at = ${slot.toISOString()}, status = 'scheduled', error = NULL
        WHERE id = ${post.id}
      `;
    }
  }

  return toMove.length;
}

async function main() {
  console.log(
    dryRun
      ? "[dry-run] recovering F007 / Getflippr..."
      : "Recovering F007 / Getflippr...",
  );

  const allFiles = [];
  for (const run of RUN_FOLDERS) {
    const files = await listRunMp4s(run);
    console.log(`  ${run}: ${files.length} mp4`);
    allFiles.push(...files);
  }

  const restored = await restoreExports(allFiles);
  console.log(
    dryRun
      ? `[dry-run] would restore ${restored} exports`
      : `Restored ${restored} exports`,
  );

  console.log("Deduplicating YouTube schedules...");
  const cancelled = await dedupeYouTube();
  console.log(
    dryRun
      ? `[dry-run] would cancel ${cancelled} duplicate YT posts`
      : `Cancelled ${cancelled} duplicate YT posts`,
  );

  const igReset = await resetMissingPosts("scheduled_posts");
  const ytReset = await resetMissingPosts("youtube_scheduled_posts");
  console.log(
    dryRun
      ? `[dry-run] would reset IG ${igReset}, YT ${ytReset}`
      : `Reset IG ${igReset}, YT ${ytReset} posts to scheduled`,
  );

  console.log("Moving past-due Instagram posts to end of queue...");
  const igMoved = await movePastDue("scheduled_posts", IG_SLOT_TIMES_UTC);
  console.log("Moving past-due YouTube posts to end of queue...");
  const ytMoved = await movePastDue(
    "youtube_scheduled_posts",
    YT_SLOT_TIMES_UTC,
  );
  console.log(
    dryRun
      ? `[dry-run] would move IG ${igMoved}, YT ${ytMoved}`
      : `Moved IG ${igMoved}, YT ${ytMoved} past-due posts`,
  );
}

main()
  .then(() => sql.end())
  .catch((err) => {
    console.error(err);
    sql.end().finally(() => process.exit(1));
  });
