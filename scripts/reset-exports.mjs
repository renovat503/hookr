#!/usr/bin/env node
/**
 * Reset finished exports only — keeps hooks, demos, music, characters, captions.
 * Usage: node scripts/reset-exports.mjs
 */
import { access, readdir, readFile, rm, unlink, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const libPath = path.join(root, "data/library.json");
const igPath = path.join(root, "data/instagram.json");

function publicPath(url) {
  if (!url?.startsWith("/")) return null;
  return path.join(root, "public", url.replace(/^\//, ""));
}

async function safeUnlink(p) {
  if (!p) return;
  try {
    await unlink(p);
    console.log("deleted", path.relative(root, p));
  } catch (err) {
    if (err.code !== "ENOENT") console.warn("skip", p, err.message);
  }
}

const lib = JSON.parse(await readFile(libPath, "utf8"));

for (const exp of lib.exports ?? []) {
  await safeUnlink(publicPath(exp.url));
}

const exportsDir = path.join(root, "public/exports");
try {
  await access(exportsDir);
  for (const name of await readdir(exportsDir)) {
    if (name === "runs" || name === ".gitkeep") continue;
    if (name.endsWith(".mp4")) await safeUnlink(path.join(exportsDir, name));
  }
  const runsDir = path.join(exportsDir, "runs");
  try {
    await access(runsDir);
    for (const run of await readdir(runsDir)) {
      if (run.startsWith(".")) continue;
      await rm(path.join(runsDir, run), { recursive: true, force: true });
      console.log("removed run dir", run);
    }
  } catch {
    // no runs folder
  }
} catch {
  // no exports folder
}

lib.exports = [];
await writeFile(libPath, JSON.stringify(lib, null, 2));
console.log("library.json: exports cleared (hooks & demos unchanged)");

try {
  const ig = JSON.parse(await readFile(igPath, "utf8"));
  ig.publishedExportIds = [];
  ig.scheduledPosts = (ig.scheduledPosts ?? []).map((post) =>
    post.status === "published"
      ? post
      : { ...post, status: "cancelled" },
  );
  await writeFile(igPath, JSON.stringify(ig, null, 2));
  console.log("instagram.json: cleared export refs");
} catch {
  // optional
}

console.log("Done.");
