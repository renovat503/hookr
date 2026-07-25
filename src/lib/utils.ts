import { clsx, type ClassValue } from "clsx";
import type { LibraryHook } from "./types";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/** ASCII-safe filename for multipart uploads (avoids FormData parse failures). */
export function safeUploadFilename(name: string, fallback = "upload.mp4"): string {
  const base = name.replace(/[^\w.\-() ]+/g, "_").replace(/_+/g, "_").trim();
  return base || fallback;
}

/** Hook is usable when overlay is burned in (or explicitly marked complete). */
export function isCompleteHook(hook: LibraryHook): boolean {
  if (hook.overlayBurned === false) return false;
  if (hook.overlayBurned === true) return true;
  return Boolean(hook.overlayText?.trim());
}

