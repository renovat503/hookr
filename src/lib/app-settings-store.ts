import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import {
  usesJsonWrite,
  usesPostgresRead,
  usesPostgresWrite,
} from "@/lib/config/storage-mode";
import {
  readAppSettingsPg,
  updateAppSettingsPg,
} from "@/lib/db/stores/app-settings";
import type { AppSettings } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_PATH = path.join(DATA_DIR, "app-settings.json");

const DEFAULT: AppSettings = {
  referenceMotionId: null,
};

function normalizeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT };
  const item = raw as Partial<AppSettings>;
  return {
    referenceMotionId:
      typeof item.referenceMotionId === "string"
        ? item.referenceMotionId
        : null,
  };
}

async function readAppSettingsJson(): Promise<AppSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf8");
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT };
  }
}

async function updateAppSettingsJson(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await readAppSettingsJson();
  const next: AppSettings = {
    ...current,
    ...patch,
    referenceMotionId:
      patch.referenceMotionId !== undefined
        ? patch.referenceMotionId
        : current.referenceMotionId,
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2));
  return next;
}

export async function readAppSettings(): Promise<AppSettings> {
  if (usesPostgresRead()) {
    try {
      return await readAppSettingsPg();
    } catch (err) {
      console.error("[settings] postgres read failed, falling back to json", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  return readAppSettingsJson();
}

export async function updateAppSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  let next: AppSettings | null = null;

  if (usesPostgresWrite()) {
    try {
      next = await updateAppSettingsPg(patch);
    } catch (err) {
      console.error("[settings] postgres write failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }

  if (usesJsonWrite()) {
    next = await updateAppSettingsJson(patch);
  }

  return next ?? { ...DEFAULT, ...patch };
}
