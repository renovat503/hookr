import { access, readFile } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import {
  isRemoteMediaUrl,
  resolveToLocalPath,
} from "@/lib/storage/media";
import { isSupabaseMediaUrl, storageKeyFromUrl } from "@/lib/storage/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

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

function contentTypeFor(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}

function sanitizeFilename(name: string) {
  const base = path.basename(name).replace(/[^\w.\-()+ ]/g, "_").trim();
  return base.length > 0 ? base : "download";
}

function isAllowedMediaUrl(mediaUrl: string): boolean {
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

function downloadBufferResponse(body: Buffer, filename: string) {
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentTypeFor(filename),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-cache",
    },
  });
}

function downloadStreamResponse(
  body: ReadableStream<Uint8Array>,
  filename: string,
) {
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentTypeFor(filename),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-cache",
    },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mediaUrl = searchParams.get("url")?.trim();
  const requestedName = searchParams.get("filename")?.trim();

  if (!mediaUrl || !isAllowedMediaUrl(mediaUrl)) {
    return NextResponse.json({ error: "Invalid download url." }, { status: 400 });
  }

  const filename = sanitizeFilename(
    requestedName ??
      path.basename(new URL(mediaUrl, "http://local").pathname) ??
      "download",
  );

  try {
    if (mediaUrl.startsWith("/")) {
      const publicDir = path.resolve(path.join(process.cwd(), "public"));
      const filePath = path.resolve(publicDir, mediaUrl.replace(/^\/+/, ""));

      if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
        return NextResponse.json({ error: "Invalid download path." }, { status: 400 });
      }

      await access(filePath);
      const file = await readFile(filePath);
      return downloadBufferResponse(file, filename);
    }

    const localPath = await resolveToLocalPath(mediaUrl);
    const stream = createReadStream(localPath);
    const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    return downloadStreamResponse(webStream, filename);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed.";
    if (/not found|missing/i.test(message)) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }
    console.error("[library/download]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
