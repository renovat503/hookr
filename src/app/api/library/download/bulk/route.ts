import { access } from "fs/promises";
import path from "path";
import { PassThrough } from "stream";
import { Readable } from "stream";
import { ZipArchive } from "archiver";
import { NextResponse } from "next/server";
import {
  isAllowedDownloadUrl,
  sanitizeDownloadFilename,
} from "@/lib/download-allowlist";
import { createDownloadFolderName } from "@/lib/download-folder-name";
import { resolveToLocalPath } from "@/lib/storage/media";

export const runtime = "nodejs";
export const maxDuration = 300;

type BulkDownloadItem = {
  url: string;
  filename: string;
};

async function resolveDownloadPath(mediaUrl: string): Promise<string> {
  if (mediaUrl.startsWith("/")) {
    const publicDir = path.resolve(path.join(process.cwd(), "public"));
    const filePath = path.resolve(publicDir, mediaUrl.replace(/^\/+/, ""));

    if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
      throw new Error("Invalid download path.");
    }

    await access(filePath);
    return filePath;
  }

  return resolveToLocalPath(mediaUrl);
}

function dedupeFilenames(filenames: string[]): string[] {
  const seen = new Map<string, number>();
  return filenames.map((filename) => {
    const count = seen.get(filename) ?? 0;
    seen.set(filename, count + 1);
    if (count === 0) return filename;
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    return `${base}-${count + 1}${ext}`;
  });
}

export async function POST(request: Request) {
  let body: { items?: BulkDownloadItem[]; folderName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const items = body.items?.filter(
    (item) => item?.url?.trim() && item?.filename?.trim(),
  );
  if (!items?.length) {
    return NextResponse.json({ error: "No files to download." }, { status: 400 });
  }

  for (const item of items) {
    if (!isAllowedDownloadUrl(item.url.trim())) {
      return NextResponse.json(
        { error: `Invalid download url: ${item.filename}` },
        { status: 400 },
      );
    }
  }

  const folderName =
    body.folderName?.replace(/[^\w.-]/g, "_").trim() ||
    createDownloadFolderName(items.length === 1 ? "hookr-export" : "hookr-exports");

  const sanitizedNames = dedupeFilenames(
    items.map((item) => sanitizeDownloadFilename(item.filename)),
  );

  const resolved: Array<{ localPath: string; zipPath: string }> = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    try {
      const localPath = await resolveDownloadPath(item.url.trim());
      resolved.push({
        localPath,
        zipPath: `${folderName}/${sanitizedNames[index]!}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "File not found.";
      return NextResponse.json(
        { error: `Could not access ${sanitizedNames[index]}: ${message}` },
        { status: 404 },
      );
    }
  }

  const archive = new ZipArchive({ zlib: { level: 5 } });
  const passThrough = new PassThrough();

  archive.on("error", (err) => {
    passThrough.destroy(err);
  });

  archive.pipe(passThrough);

  for (const file of resolved) {
    archive.file(file.localPath, { name: file.zipPath });
  }

  void archive.finalize();

  const webStream = Readable.toWeb(passThrough) as ReadableStream<Uint8Array>;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${folderName}.zip"`,
      "Cache-Control": "private, no-cache",
    },
  });
}
