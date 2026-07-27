const STORAGE_KEY = "hookr-downloaded-exports";

type DownloadCounts = Record<string, number>;

function readCounts(): DownloadCounts {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const counts: DownloadCounts = {};
      for (const id of parsed) {
        if (typeof id === "string") counts[id] = 1;
      }
      writeCounts(counts);
      return counts;
    }
    if (parsed && typeof parsed === "object") {
      const counts: DownloadCounts = {};
      for (const [id, value] of Object.entries(parsed)) {
        if (typeof value === "number" && value > 0) counts[id] = value;
      }
      return counts;
    }
  } catch {
    // ignore corrupt storage
  }
  return {};
}

function writeCounts(counts: DownloadCounts): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
}

export function getDownloadCounts(): DownloadCounts {
  return readCounts();
}

export function getExportDownloadCount(exportId: string): number {
  return readCounts()[exportId] ?? 0;
}

/** @deprecated Use getExportDownloadCount or getDownloadCounts */
export function getDownloadedExportIds(): Set<string> {
  const counts = readCounts();
  return new Set(Object.keys(counts).filter((id) => (counts[id] ?? 0) > 0));
}

export function markExportDownloaded(exportId: string): number {
  const counts = readCounts();
  const next = (counts[exportId] ?? 0) + 1;
  counts[exportId] = next;
  writeCounts(counts);
  return next;
}
