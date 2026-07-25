import { mkdir, readFile, unlink, writeFile, stat } from "fs/promises";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import path from "path";
import { constants as fsConstants } from "fs";
import { access } from "fs/promises";
import {
  getPublicMediaBaseUrl,
  getStorageBucket,
  getSupabaseAdmin,
  isSupabaseMediaUrl,
  storageKeyFromUrl,
  toPublicMediaUrl,
} from "./supabase";
import {
  usesLocalMediaWrite,
  usesSupabaseWrite,
} from "@/lib/config/storage-mode";
import { hookrTmpDir } from "@/lib/ffmpeg";

export function isRemoteMediaUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

export function localPublicUrl(relativePath: string): string {
  return `/${relativePath.replace(/^\/+/, "")}`;
}

export function localPathFromPublicUrl(publicUrl: string): string {
  return path.join(process.cwd(), "public", publicUrl.replace(/^\//, ""));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function uploadBufferToSupabase(options: {
  storageKey: string;
  buffer: Buffer;
  contentType: string;
  upsert?: boolean;
}): Promise<string> {
  const key = options.storageKey.replace(/^\/+/, "");
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(getStorageBucket()).upload(
    key,
    options.buffer,
    {
      contentType: options.contentType,
      upsert: options.upsert ?? false,
    },
  );
  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }
  return toPublicMediaUrl(key);
}

export async function uploadFileToSupabase(options: {
  storageKey: string;
  localPath: string;
  contentType: string;
  upsert?: boolean;
}): Promise<string> {
  const buffer = await readFile(options.localPath);
  return uploadBufferToSupabase({
    storageKey: options.storageKey,
    buffer,
    contentType: options.contentType,
    upsert: options.upsert,
  });
}

export async function deleteFromSupabase(urlOrKey: string): Promise<void> {
  const key =
    storageKeyFromUrl(urlOrKey) ?? urlOrKey.replace(/^\/+/, "");
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(getStorageBucket()).remove([key]);
  if (error) {
    throw new Error(`Supabase delete failed: ${error.message}`);
  }
}

export async function saveMediaBuffer(options: {
  storageKey: string;
  buffer: Buffer;
  contentType: string;
  upsert?: boolean;
}): Promise<string> {
  const key = options.storageKey.replace(/^\/+/, "");
  let url = localPublicUrl(key);

  if (usesLocalMediaWrite()) {
    const localPath = localPathFromPublicUrl(url);
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, options.buffer);
  }

  if (usesSupabaseWrite()) {
    url = await uploadBufferToSupabase({
      storageKey: key,
      buffer: options.buffer,
      contentType: options.contentType,
      upsert: options.upsert,
    });
  }

  return url;
}

export async function saveMediaFromLocalPath(options: {
  storageKey: string;
  localPath: string;
  contentType: string;
  upsert?: boolean;
}): Promise<string> {
  const buffer = await readFile(options.localPath);
  return saveMediaBuffer({
    storageKey: options.storageKey,
    buffer,
    contentType: options.contentType,
    upsert: options.upsert,
  });
}

export async function deleteMedia(url: string): Promise<void> {
  if (url.startsWith("/")) {
    if (usesLocalMediaWrite()) {
      await unlink(localPathFromPublicUrl(url)).catch(() => undefined);
    }
  }
  if (isRemoteMediaUrl(url) && isSupabaseMediaUrl(url) && usesSupabaseWrite()) {
    await deleteFromSupabase(url).catch(() => undefined);
  }
}

export async function resolveToLocalPath(url: string): Promise<string> {
  if (!url) {
    throw new Error("Media URL is required.");
  }

  if (url.startsWith("/")) {
    const localPath = localPathFromPublicUrl(url);
    if (!(await fileExists(localPath))) {
      throw new Error(`Media file is missing on disk: ${url}`);
    }
    return localPath;
  }

  if (isRemoteMediaUrl(url)) {
    const tmpDir = path.join(hookrTmpDir(), "media-cache");
    await mkdir(tmpDir, { recursive: true });
    const ext = path.extname(new URL(url).pathname) || ".mp4";
    const cacheName = `remote-${Buffer.from(url).toString("base64url").slice(0, 48)}${ext}`;
    const cachedPath = path.join(tmpDir, cacheName);

    if (await fileExists(cachedPath)) {
      const { size } = await stat(cachedPath);
      if (size >= 1024) {
        return cachedPath;
      }
      await unlink(cachedPath).catch(() => undefined);
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      throw new Error(`Could not download media (${res.status}): ${url}`);
    }
    if (!res.body) {
      throw new Error(`Could not download media (empty body): ${url}`);
    }
    await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(cachedPath));
    const { size } = await stat(cachedPath);
    if (size < 1024) {
      await unlink(cachedPath).catch(() => undefined);
      throw new Error(`Downloaded media is too small (${size} bytes): ${url}`);
    }
    return cachedPath;
  }

  throw new Error(`Unsupported media URL: ${url}`);
}

export async function overwriteMediaAtUrl(options: {
  url: string;
  localPath: string;
  contentType: string;
}): Promise<string> {
  const key =
    storageKeyFromUrl(options.url) ??
    options.url.replace(/^\//, "");

  return saveMediaFromLocalPath({
    storageKey: key,
    localPath: options.localPath,
    contentType: options.contentType,
    upsert: true,
  });
}

export function guessVideoContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  return "video/mp4";
}

export function guessImageContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

export function guessAudioContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  return "audio/mpeg";
}

export { getPublicMediaBaseUrl };
