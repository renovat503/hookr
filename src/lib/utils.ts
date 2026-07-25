import { clsx, type ClassValue } from "clsx";
import type { LibraryHook } from "./types";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/** Hook is usable when overlay is burned in (or explicitly marked complete). */
export function isCompleteHook(hook: LibraryHook): boolean {
  if (hook.overlayBurned === false) return false;
  if (hook.overlayBurned === true) return true;
  return Boolean(hook.overlayText?.trim());
}

