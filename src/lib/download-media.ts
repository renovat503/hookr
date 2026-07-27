import { createDownloadFolderName } from "@/lib/download-folder-name";
import type { LibraryExport } from "@/lib/types";

export function filenameFromMediaUrl(url: string, fallback = "video.mp4") {
  const segment = url.split("/").pop()?.split("?")[0]?.trim();
  return segment && segment.length > 0 ? segment : fallback;
}

export function exportDownloadFilename(exp: LibraryExport): string {
  return filenameFromMediaUrl(exp.url, `${exp.id}.mp4`);
}

function triggerBrowserDownload(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function buildBulkDownloadUrl(
  items: Array<{ id?: string; url: string; filename: string }>,
  folderName: string,
): string {
  const ids = items.map((item) => item.id).filter(Boolean) as string[];

  if (ids.length === items.length) {
    const params = new URLSearchParams({
      ids: ids.join(","),
      folderName,
    });
    return `/api/library/download/bulk?${params.toString()}`;
  }

  if (items.length === 1) {
    const item = items[0]!;
    const params = new URLSearchParams({
      url: item.url,
      filename: item.filename,
      folderName,
    });
    return `/api/library/download/bulk?${params.toString()}`;
  }

  throw new Error("Bulk download requires export ids.");
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

  const downloadUrl = buildBulkDownloadUrl(items, folderName);

  options?.onProgress?.({
    phase: "downloading",
    total: items.length,
    folderName,
  });

  triggerBrowserDownload(downloadUrl);

  return {
    folderName,
    zipFilename: `${folderName}.zip`,
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
