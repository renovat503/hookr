import { execSync } from "node:child_process";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.log("[db] DATABASE_URL not set — skipping schema push.");
  process.exit(0);
}

try {
  console.log("[db] Syncing Postgres schema (drizzle-kit push)…");
  execSync("npx drizzle-kit push", {
    stdio: "inherit",
    env: process.env,
  });
  console.log("[db] Schema sync complete.");
} catch (err) {
  console.error("[db] Schema push failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
