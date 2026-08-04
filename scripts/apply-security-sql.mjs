#!/usr/bin/env node
/**
 * Apply supabase/migrations/* security SQL using DATABASE_URL.
 * Usage: node scripts/apply-security-sql.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // optional
  }
}

loadEnvLocal();

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const migrationsDir = path.join(process.cwd(), "supabase/migrations");
const onlyAutomated = process.argv.includes("--automated-only");
const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .filter((name) =>
    onlyAutomated
      ? !name.includes("storage_policies")
      : true,
  )
  .sort();

if (!files.length) {
  console.error("No SQL migrations found in supabase/migrations.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

try {
  for (const file of files) {
    const body = readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`Applying ${file}...`);
    await sql.unsafe(body);
    console.log(`Applied ${file}.`);
  }
  console.log("Security migrations complete.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
