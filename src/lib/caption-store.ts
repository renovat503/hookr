import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import {
  usesJsonWrite,
  usesPostgresRead,
  usesPostgresWrite,
} from "@/lib/config/storage-mode";
import {
  addCaptionsPg,
  readCaptionsPg,
  removeCaptionPg,
  updateCaptionPg,
  writeCaptionsPg,
} from "@/lib/db/stores/captions";
import type { LibraryCaption } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const CAPTIONS_PATH = path.join(DATA_DIR, "captions.json");

type CaptionFile = {
  captions: LibraryCaption[];
};

function normalizeCaption(raw: unknown): LibraryCaption | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<LibraryCaption>;
  if (typeof item.id !== "string" || typeof item.text !== "string") return null;
  const text = item.text.trim();
  if (!text) return null;
  return {
    id: item.id,
    text,
    tags: Array.isArray(item.tags)
      ? item.tags.filter((t): t is string => typeof t === "string")
      : [],
    createdAt:
      typeof item.createdAt === "string"
        ? item.createdAt
        : new Date().toISOString(),
  };
}

async function readCaptionsJson(): Promise<LibraryCaption[]> {
  try {
    const raw = await readFile(CAPTIONS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CaptionFile>;
    return (parsed.captions ?? [])
      .map(normalizeCaption)
      .filter((c): c is LibraryCaption => c != null);
  } catch {
    return [];
  }
}

async function writeCaptionsJson(captions: LibraryCaption[]) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    CAPTIONS_PATH,
    JSON.stringify({ captions }, null, 2),
    "utf8",
  );
}

export function createCaptionId(): string {
  return `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function readCaptions(): Promise<LibraryCaption[]> {
  if (usesPostgresRead()) {
    try {
      return await readCaptionsPg();
    } catch (err) {
      console.error("[captions] postgres read failed, falling back to json", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  return readCaptionsJson();
}

export async function addCaptions(
  texts: string[],
  tags: string[] = [],
): Promise<LibraryCaption[]> {
  const existing = await readCaptions();
  const existingTexts = new Set(
    existing.map((c) => c.text.trim().toLowerCase()),
  );
  const now = new Date().toISOString();
  const added: LibraryCaption[] = [];

  for (const raw of texts) {
    const text = raw.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (existingTexts.has(key)) continue;
    existingTexts.add(key);
    added.push({
      id: createCaptionId(),
      text,
      tags: [...tags],
      createdAt: now,
    });
  }

  if (!added.length) return [];

  if (usesJsonWrite()) {
    await writeCaptionsJson([...added, ...existing]);
  }
  if (usesPostgresWrite()) {
    try {
      await addCaptionsPg(added);
    } catch (err) {
      console.error("[captions] postgres write failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }

  return added;
}

export async function removeCaption(id: string): Promise<boolean> {
  const existing = await readCaptions();
  const next = existing.filter((c) => c.id !== id);
  if (next.length === existing.length) return false;

  if (usesJsonWrite()) {
    await writeCaptionsJson(next);
  }
  if (usesPostgresWrite()) {
    try {
      await removeCaptionPg(id);
    } catch (err) {
      console.error("[captions] postgres delete failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }

  return true;
}

export async function updateCaption(
  id: string,
  text: string,
): Promise<LibraryCaption | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const existing = await readCaptions();
  const index = existing.findIndex((c) => c.id === id);
  if (index < 0) return null;

  const duplicate = existing.find(
    (c) => c.id !== id && c.text.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (duplicate) {
    throw new Error("A caption with this text already exists.");
  }

  const updated: LibraryCaption = {
    ...existing[index],
    text: trimmed,
  };
  const next = [...existing];
  next[index] = updated;

  if (usesJsonWrite()) {
    await writeCaptionsJson(next);
  }
  if (usesPostgresWrite()) {
    try {
      await updateCaptionPg(id, trimmed);
    } catch (err) {
      console.error("[captions] postgres update failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }

  return updated;
}

export async function importCaptionLines(
  content: string,
): Promise<{ added: LibraryCaption[]; skipped: number }> {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const added = await addCaptions(lines);
  return { added, skipped: lines.length - added.length };
}

/** Bulk replace captions — used by migration tooling. */
export async function replaceAllCaptions(captions: LibraryCaption[]): Promise<void> {
  if (usesJsonWrite()) {
    await writeCaptionsJson(captions);
  }
  if (usesPostgresWrite()) {
    await writeCaptionsPg(captions);
  }
}
