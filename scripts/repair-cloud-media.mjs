#!/usr/bin/env node
/**
 * Upload local public/ media files to Supabase and update Postgres URLs.
 * Use when demos/hooks in the DB still point at /uploads/... paths.
 *
 *   node --env-file=.env.local scripts/repair-cloud-media.mjs
 *   node --env-file=.env.local scripts/repair-cloud-media.mjs --dry-run
 */
import { readFile, stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

function required(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
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

function toPublicUrl(key) {
  return `${PUBLIC_BASE}/${key.replace(/^\/+/, "")}`;
}

async function uploadKey(key, contentType = "video/mp4") {
  const localPath = path.join(root, "public", key);
  try {
    await stat(localPath);
  } catch {
    console.warn(`  missing local file: public/${key}`);
    return null;
  }
  if (dryRun) {
    console.log(`  would upload ${key}`);
    return toPublicUrl(key);
  }
  const buffer = await readFile(localPath);
  const { error } = await supabase.storage.from(BUCKET).upload(key, buffer, {
    contentType,
    upsert: true,
  });
  if (error) {
    console.warn(`  upload failed ${key}: ${error.message}`);
    return null;
  }
  console.log(`  uploaded ${key}`);
  return toPublicUrl(key);
}

async function objectExists(key) {
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  return !error && data && data.size >= 1024;
}

async function auditTable(table, idCol, urlCol) {
  const rows = await sql.unsafe(`select ${idCol} as id, ${urlCol} as url from ${table}`);
  const missing = [];
  for (const row of rows) {
    if (!row.url?.startsWith("http")) continue;
    const key = row.url.replace(`${PUBLIC_BASE}/`, "").replace(/^\/+/, "");
    if (!(await objectExists(key))) {
      missing.push({ id: row.id, key });
    }
  }
  if (missing.length) {
    console.warn(`${table}: ${missing.length} DB record(s) with missing storage file:`);
    for (const item of missing) {
      console.warn(`  ${item.id} → ${item.key}`);
    }
  } else {
    console.log(`${table}: all remote URLs verified in storage`);
  }
  return missing;
}

async function rewriteTable(table, idCol, urlCol) {
  const rows = await sql.unsafe(`select ${idCol} as id, ${urlCol} as url from ${table}`);
  let updated = 0;
  for (const row of rows) {
    if (!row.url || row.url.startsWith("http")) continue;
    const key = row.url.replace(/^\//, "");
    const next = await uploadKey(key);
    if (!next) continue;
    if (!dryRun) {
      await sql.unsafe(`update ${table} set ${urlCol} = $1 where ${idCol} = $2`, [next, row.id]);
    }
    updated += 1;
  }
  console.log(`${table}: ${updated} url(s) ${dryRun ? "would be " : ""}updated`);
}

async function main() {
  console.log(dryRun ? "Dry run" : "Repairing cloud media URLs");
  await rewriteTable("demos", "id", "url");
  await rewriteTable("music", "id", "url");
  await rewriteTable("hooks", "id", "url");
  await rewriteTable("hooks", "id", "raw_url");
  await rewriteTable("motions", "id", "url");
  await rewriteTable("exports", "id", "url");
  await rewriteTable("exports", "id", "hook_url");
  await rewriteTable("exports", "id", "demo_url");

  console.log("\nAuditing remote URLs against storage…");
  await auditTable("demos", "id", "url");
  await auditTable("music", "id", "url");
  await auditTable("hooks", "id", "url");
  await auditTable("hooks", "id", "raw_url");
  await auditTable("motions", "id", "url");
  await auditTable("exports", "id", "url");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
