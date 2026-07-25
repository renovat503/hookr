export function filenameFromMediaUrl(url: string, fallback = "video.mp4") {
  const segment = url.split("/").pop()?.split("?")[0]?.trim();
  return segment && segment.length > 0 ? segment : fallback;
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
