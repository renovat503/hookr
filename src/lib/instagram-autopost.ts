import type { InstagramData, LibraryExport } from "./types";

export const AUTO_POST_INTERVAL_HOURS_OPTIONS = [4, 5, 6] as const;
export type AutoPostIntervalHours = (typeof AUTO_POST_INTERVAL_HOURS_OPTIONS)[number];

export const DEFAULT_AUTO_POST_INTERVAL_HOURS: AutoPostIntervalHours = 5;

export function normalizeAutoPostIntervalHours(
  hours: number | undefined,
): AutoPostIntervalHours {
  if (hours === 4 || hours === 5 || hours === 6) return hours;
  return DEFAULT_AUTO_POST_INTERVAL_HOURS;
}

export function getAutoPostIntervalMs(data: InstagramData): number {
  return normalizeAutoPostIntervalHours(data.autoPostIntervalHours) * 60 * 60 * 1000;
}

export function formatAutoPostInterval(
  ms: number,
): string {
  const mins = Math.round(ms / (60 * 1000));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = mins / 60;
  if (Number.isInteger(hours)) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours.toFixed(1)} hours`;
}

export function getAccountLastPublishedAt(
  data: InstagramData,
  accountId: string,
): string | null {
  const stored = data.accountLastPublishedAt?.[accountId];
  if (stored) return stored;

  let latest: string | null = null;
  for (const post of data.scheduledPosts) {
    if (post.accountId !== accountId || post.status !== "published") continue;
    if (!post.publishedAt) continue;
    if (!latest || post.publishedAt > latest) latest = post.publishedAt;
  }
  return latest;
}

export function isAccountEligibleForAutoPost(
  data: InstagramData,
  accountId: string,
  now = Date.now(),
): boolean {
  const lastAt = getAccountLastPublishedAt(data, accountId);
  if (!lastAt) return true;
  return now - new Date(lastAt).getTime() >= getAutoPostIntervalMs(data);
}

export function getNextEligibleAt(
  data: InstagramData,
  accountId: string,
): string | null {
  const lastAt = getAccountLastPublishedAt(data, accountId);
  if (!lastAt) return null;
  return new Date(
    new Date(lastAt).getTime() + getAutoPostIntervalMs(data),
  ).toISOString();
}

export function getReservedExportIds(data: InstagramData): Set<string> {
  const reserved = new Set<string>();
  for (const post of data.scheduledPosts) {
    if (post.status === "scheduled" || post.status === "publishing") {
      reserved.add(post.exportId);
    }
  }
  return reserved;
}

export function pickOldestUnpublishedExport(
  exports: LibraryExport[],
  publishedIds: Set<string>,
  reservedIds: Set<string>,
): LibraryExport | null {
  const candidates = exports
    .filter(
      (exp) =>
        exp.status === "ready" &&
        !publishedIds.has(exp.id) &&
        !reservedIds.has(exp.id),
    )
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  return candidates[0] ?? null;
}

export function buildAutoPostCaption(exp: LibraryExport): string {
  return (
    [exp.overlayText, exp.name].filter(Boolean).join("\n\n") ||
    exp.name ||
    "Hookr"
  );
}

export type AutoPostQueuePreview = {
  exportId: string | null;
  exportName: string | null;
  /** When the next auto-post can run (ISO). Null if ready now or no queue. */
  postsAt: string | null;
  eligibleNow: boolean;
};

/** Next video in the auto-post queue and when it will publish. */
export function getAutoPostQueuePreview(
  instagram: InstagramData,
  exports: LibraryExport[],
  now = Date.now(),
): AutoPostQueuePreview {
  const empty: AutoPostQueuePreview = {
    exportId: null,
    exportName: null,
    postsAt: null,
    eligibleNow: false,
  };

  if (!instagram.autoPostEnabled || !instagram.accounts.length) {
    return empty;
  }

  const published = new Set(instagram.publishedExportIds);
  const reserved = getReservedExportIds(instagram);
  const nextExport = pickOldestUnpublishedExport(exports, published, reserved);
  if (!nextExport) return empty;

  let eligibleNow = false;
  let earliestMs: number | null = null;

  for (const account of instagram.accounts) {
    if (isAccountEligibleForAutoPost(instagram, account.id, now)) {
      eligibleNow = true;
      break;
    }
    const nextAt = getNextEligibleAt(instagram, account.id);
    if (!nextAt) {
      eligibleNow = true;
      break;
    }
    const ms = new Date(nextAt).getTime();
    if (earliestMs === null || ms < earliestMs) earliestMs = ms;
  }

  return {
    exportId: nextExport.id,
    exportName: nextExport.name,
    postsAt: eligibleNow
      ? new Date(now).toISOString()
      : earliestMs !== null
        ? new Date(earliestMs).toISOString()
        : null,
    eligibleNow,
  };
}
