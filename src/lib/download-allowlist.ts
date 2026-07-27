import { isRemoteMediaUrl } from "@/lib/storage/media";
import { isSupabaseMediaUrl, storageKeyFromUrl } from "@/lib/storage/supabase";

const ALLOWED_PATH_PREFIXES = [
  "/exports/",
  "/generated/",
  "/uploads/demos/",
  "/uploads/hooks/",
  "/uploads/motions/",
  "/uploads/music/",
  "/uploads/characters/",
  "/characters/",
];

const ALLOWED_STORAGE_PREFIXES = [
  "exports/",
  "generated/",
  "uploads/demos/",
  "uploads/hooks/",
  "uploads/motions/",
  "uploads/music/",
  "uploads/characters/",
  "characters/",
];

export function sanitizeDownloadFilename(name: string): string {
  const base = name.replace(/^.*[/\\]/, "").replace(/[^\w.\-()+ ]/g, "_").trim();
  return base.length > 0 ? base : "download";
}

export function isAllowedDownloadUrl(mediaUrl: string): boolean {
  if (ALLOWED_PATH_PREFIXES.some((prefix) => mediaUrl.startsWith(prefix))) {
    return true;
  }
  if (!isRemoteMediaUrl(mediaUrl) || !isSupabaseMediaUrl(mediaUrl)) {
    return false;
  }
  const key = storageKeyFromUrl(mediaUrl);
  if (!key) return false;
  return ALLOWED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}
