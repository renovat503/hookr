import { access, readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ALLOWED_PREFIXES = [
  "/exports/",
  "/generated/",
  "/uploads/demos/",
  "/uploads/hooks/",
  "/uploads/music/",
  "/uploads/characters/",
  "/characters/",
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mediaUrl = searchParams.get("url")?.trim();
  const requestedName = searchParams.get("filename")?.trim();

  if (!mediaUrl || !ALLOWED_PREFIXES.some((prefix) => mediaUrl.startsWith(prefix))) {
    return NextResponse.json({ error: "Invalid download url." }, { status: 400 });
  }

  const publicDir = path.resolve(path.join(process.cwd(), "public"));
  const filePath = path.resolve(publicDir, mediaUrl.replace(/^\/+/, ""));

  if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
    return NextResponse.json({ error: "Invalid download path." }, { status: 400 });
  }

  try {
    await access(filePath);
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const filename = sanitizeFilename(requestedName ?? path.basename(filePath));
  const file = await readFile(filePath);

  return new NextResponse(file, {
    headers: {
      "Content-Type": contentTypeFor(filename),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-cache",
    },
  });
}
