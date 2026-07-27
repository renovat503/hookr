import { NextResponse } from "next/server";
import { readLibrary } from "@/lib/library-store";
import {
  buildZipDownloadResponse,
  exportDownloadFilenameFromUrl,
  resolveDownloadFolderName,
  type ZipDownloadItem,
} from "@/lib/download-zip";

export const runtime = "nodejs";
export const maxDuration = 300;

type BulkDownloadBody = {
  items?: Array<{ url: string; filename: string }>;
  folderName?: string;
};

function itemsFromIds(ids: string[]): Promise<ZipDownloadItem[] | NextResponse> {
  return readLibrary("exports").then((library) => {
    const exportsById = new Map(library.exports.map((exp) => [exp.id, exp]));
    const items: ZipDownloadItem[] = [];

    for (const id of ids) {
      const exp = exportsById.get(id);
      if (!exp) {
        return NextResponse.json(
          { error: `Export not found: ${id}` },
          { status: 404 },
        );
      }
      items.push({
        url: exp.url,
        filename: exportDownloadFilenameFromUrl(exp.url, exp.id),
      });
    }

    return items;
  });
}

async function handleDownload(
  items: ZipDownloadItem[],
  folderName: string,
): Promise<NextResponse> {
  try {
    return await buildZipDownloadResponse(items, folderName);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed.";
    console.error("[library/download/bulk]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids")?.trim();
  const url = searchParams.get("url")?.trim();
  const filename = searchParams.get("filename")?.trim();
  const requestedFolderName = searchParams.get("folderName");

  if (idsParam) {
    const ids = idsParam.split(",").map((id) => id.trim()).filter(Boolean);
    if (!ids.length) {
      return NextResponse.json({ error: "No export ids provided." }, { status: 400 });
    }

    const resolved = await itemsFromIds(ids);
    if (resolved instanceof NextResponse) return resolved;
    const folderName = resolveDownloadFolderName(resolved.length, requestedFolderName);
    return handleDownload(resolved, folderName);
  }

  if (url && filename) {
    const folderName = resolveDownloadFolderName(1, requestedFolderName);
    return handleDownload([{ url, filename }], folderName);
  }

  return NextResponse.json(
    { error: "Provide export ids or url+filename." },
    { status: 400 },
  );
}

export async function POST(request: Request) {
  let body: BulkDownloadBody;
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

  const folderName = resolveDownloadFolderName(
    items.length,
    body.folderName,
  );

  return handleDownload(
    items.map((item) => ({
      url: item.url.trim(),
      filename: item.filename.trim(),
    })),
    folderName,
  );
}
