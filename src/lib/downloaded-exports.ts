const STORAGE_KEY = "hookr-downloaded-exports";

export function getDownloadedExportIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function markExportDownloaded(exportId: string): void {
  const ids = getDownloadedExportIds();
  ids.add(exportId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}
