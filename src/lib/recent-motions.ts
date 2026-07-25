export type RecentMotionRef = {
  id: string;
  lastUsedAt: number;
};

const STORAGE_KEY = "hookr-recent-motions";
const MAX_STORED = 24;

export function loadRecentMotions(): RecentMotionRef[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentMotionRef[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.lastUsedAt === "number",
      )
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, MAX_STORED);
  } catch {
    return [];
  }
}

export function touchRecentMotion(id: string): RecentMotionRef[] {
  const now = Date.now();
  const next: RecentMotionRef[] = [
    { id, lastUsedAt: now },
    ...loadRecentMotions().filter((item) => item.id !== id),
  ].slice(0, MAX_STORED);

  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function removeRecentMotion(id: string): RecentMotionRef[] {
  const next = loadRecentMotions().filter((item) => item.id !== id);
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}
