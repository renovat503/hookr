import { createDownloadFolderName } from "@/lib/download-folder-name";
import type { LibraryExport } from "@/lib/types";

export function filenameFromMediaUrl(url: string, fallback = "video.mp4") {
  const segment = url.split("/").pop()?.split("?")[0]?.trim();
  return segment && segment.length > 0 ? segment : fallback;
}

export function exportDownloadFilename(exp: LibraryExport): string {
  return filenameFromMediaUrl(exp.url, `${exp.id}.mp4`);
}

function triggerBrowserDownload(href: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export type BulkDownloadProgress = {
  phase: "packaging" | "downloading";
  total: number;
  folderName: string;
};

export async function downloadMediaZip(
  items: Array<{ url: string; filename: string }>,
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
    body: JSON.stringify({ items, folderName }),
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
  const objectUrl = URL.createObjectURL(blob);

  try {
    triggerBrowserDownload(objectUrl, zipFilename);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }

  return { folderName, zipFilename, fileCount: items.length };
}

/** Download one video inside a timestamped folder (delivered as a zip). */
export async function downloadMedia(url: string, filename: string) {
  await downloadMediaZip([{ url, filename }]);
}

export async function downloadMediaBulk(
  items: Array<{ url: string; filename: string }>,
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
