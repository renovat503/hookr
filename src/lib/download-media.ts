import type { LibraryExport } from "@/lib/types";

export function filenameFromMediaUrl(url: string, fallback = "video.mp4") {
  const segment = url.split("/").pop()?.split("?")[0]?.trim();
  return segment && segment.length > 0 ? segment : fallback;
}

export function exportDownloadFilename(exp: LibraryExport): string {
  return filenameFromMediaUrl(exp.url, `${exp.id}.mp4`);
}

function buildDownloadApiUrl(url: string, filename: string) {
  const params = new URLSearchParams({
    url,
    filename,
  });
  return `/api/library/download?${params.toString()}`;
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

export async function downloadMedia(url: string, filename: string) {
  const apiUrl = buildDownloadApiUrl(url, filename);
  const response = await fetch(apiUrl);

  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(
      err?.error ?? `Could not download file (${response.status}).`,
    );
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    triggerBrowserDownload(objectUrl, filename);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

export type BulkDownloadProgress = {
  current: number;
  total: number;
  filename: string;
};

export async function downloadMediaBulk(
  items: Array<{ url: string; filename: string }>,
  options?: {
    onProgress?: (progress: BulkDownloadProgress) => void;
    delayMs?: number;
  },
): Promise<{ downloaded: number; failed: string[] }> {
  const failed: string[] = [];
  let downloaded = 0;
  const delayMs = options?.delayMs ?? 400;

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    options?.onProgress?.({
      current: index + 1,
      total: items.length,
      filename: item.filename,
    });

    try {
      await downloadMedia(item.url, item.filename);
      downloaded += 1;
    } catch {
      failed.push(item.filename);
    }

    if (index < items.length - 1 && delayMs > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }

  return { downloaded, failed };
}
