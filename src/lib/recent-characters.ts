export type RecentCharacterRef = {
  type: "preset" | "library";
  id: string;
  lastUsedAt: number;
};

const STORAGE_KEY = "hookr-recent-characters";
const MAX_STORED = 24;

export function loadRecentCharacters(): RecentCharacterRef[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentCharacterRef[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item) =>
          item &&
          (item.type === "preset" || item.type === "library") &&
          typeof item.id === "string" &&
          typeof item.lastUsedAt === "number",
      )
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, MAX_STORED);
  } catch {
    return [];
  }
}

export function touchRecentCharacter(
  ref: Pick<RecentCharacterRef, "type" | "id">,
): RecentCharacterRef[] {
  const now = Date.now();
  const next: RecentCharacterRef[] = [
    { ...ref, lastUsedAt: now },
    ...loadRecentCharacters().filter(
      (item) => !(item.type === ref.type && item.id === ref.id),
    ),
  ].slice(0, MAX_STORED);

  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function removeRecentCharacter(
  ref: Pick<RecentCharacterRef, "type" | "id">,
): RecentCharacterRef[] {
  const next = loadRecentCharacters().filter(
    (item) => !(item.type === ref.type && item.id === ref.id),
  );
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}
