import { copyFile, mkdir } from "fs/promises";
import path from "path";
import { constants as fsConstants } from "fs";
import { access } from "fs/promises";
import type { LibraryHook } from "./types";
import {
  localPathFromPublicUrl,
  resolveToLocalPath,
  saveMediaFromLocalPath,
} from "@/lib/storage/media";

async function exists(p: string) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the caption-free source for a library hook.
 * Prefers rawUrl, then sibling `-raw.mp4`, then the current url as last resort.
 */
export async function resolveHookRawPath(hook: LibraryHook): Promise<{
  path: string;
  rawUrl: string;
  isTrueRaw: boolean;
}> {
  if (hook.rawUrl) {
    try {
      const p = await resolveToLocalPath(hook.rawUrl);
      return { path: p, rawUrl: hook.rawUrl, isTrueRaw: true };
    } catch {
      // fall through
    }
  }

  const siblingRaw = hook.url.replace(/\.mp4$/i, "-raw.mp4");
  try {
    const siblingPath = await resolveToLocalPath(siblingRaw);
    return { path: siblingPath, rawUrl: siblingRaw, isTrueRaw: true };
  } catch {
    // fall through
  }

  const current = await resolveToLocalPath(hook.url);
  if (await exists(current)) {
    return { path: current, rawUrl: hook.url, isTrueRaw: false };
  }

  throw new Error("Source hook video file is missing.");
}

export async function ensureRawCopy(
  sourcePath: string,
  destPublicUrl: string,
): Promise<string> {
  const storageKey = destPublicUrl.replace(/^\/+/, "");
  const localDest = localPathFromPublicUrl(destPublicUrl);
  await mkdir(path.dirname(localDest), { recursive: true });
  if (!(await exists(localDest))) {
    await copyFile(sourcePath, localDest);
  }

  return saveMediaFromLocalPath({
    storageKey,
    localPath: localDest,
    contentType: "video/mp4",
    upsert: true,
  });
}
