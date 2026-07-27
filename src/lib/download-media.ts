import { createDownloadFolderName } from "@/lib/download-folder-name";
import type { LibraryExport } from "@/lib/types";

export function filenameFromMediaUrl(url: string, fallback = "video.mp4") {
  const segment = url.split("/").pop()?.split("?")[0]?.trim();
  return segment && segment.length > 0 ? segment : fallback;
}

export function exportDownloadFilename(exp: LibraryExport): string {
  return filenameFromMediaUrl(exp.url, `${exp.id}.mp4`);
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000);
}

function buildBulkDownloadBody(
  items: Array<{ id?: string; url: string; filename: string }>,
  folderName: string,
) {
  const ids = items.map((item) => item.id).filter(Boolean) as string[];
  if (ids.length === items.length) {
    return { ids, folderName };
  }
  return {
    items: items.map((item) => ({
      url: item.url,
      filename: item.filename,
    })),
    folderName,
  };
}

export type BulkDownloadProgress = {
  phase: "packaging" | "downloading";
  total: number;
  folderName: string;
};

export async function downloadMediaZip(
  items: Array<{ id?: string; url: string; filename: string }>,
  options?: {
    folderName?: string;
    onProgress?: (progress: BulkDownloadProgress) => void;
  },
): Promise<{ folderName: string; zipFilename: string; fileCount: number }> {
  if (!items.length) {
    throw new Error("No files to download.");
  }

  const folderName =
    options?.folderName ??
    createDownloadFolderName(items.length === 1 ? "hookr-export" : "hookr-exports");

  options?.onProgress?.({
    phase: "packaging",
    total: items.length,
    folderName,
  });

  const response = await fetch("/api/library/download/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBulkDownloadBody(items, folderName)),
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(
      err?.error ?? `Could not prepare download (${response.status}).`,
    );
  }

  options?.onProgress?.({
    phase: "downloading",
    total: items.length,
    folderName,
  });

  const blob = await response.blob();
  const zipFilename = `${folderName}.zip`;
  triggerBlobDownload(blob, zipFilename);

  return {
    folderName,
    zipFilename,
    fileCount: items.length,
  };
}

/** Download one video inside a timestamped folder (delivered as a zip). */
export async function downloadMedia(
  url: string,
  filename: string,
  exportId?: string,
) {
  await downloadMediaZip([{ id: exportId, url, filename }]);
}

export async function downloadMediaBulk(
  items: Array<{ id?: string; url: string; filename: string }>,
  options?: {
    folderName?: string;
    onProgress?: (progress: BulkDownloadProgress) => void;
  },
): Promise<{ downloaded: number; failed: string[]; folderName: string }> {
  const result = await downloadMediaZip(items, options);
  return {
    downloaded: result.fileCount,
    failed: [],
    folderName: result.folderName,
  };
}
