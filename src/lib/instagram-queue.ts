import type {
  InstagramData,
  LibraryExport,
  ScheduledPost,
  ScheduledPostSource,
} from "./types";

export function inferPostSource(post: ScheduledPost): ScheduledPostSource {
  if (post.source) return post.source;
  if (post.id.startsWith("auto-")) return "auto";
  if (post.id.startsWith("queue-") || post.status === "queued") return "queue";
  return "manual";
}

export function getPublishedExportIdsForAccount(
  data: InstagramData,
  accountId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const post of data.scheduledPosts) {
    if (post.accountId === accountId && post.status === "published") {
      ids.add(post.exportId);
    }
  }
  return ids;
}

export function isExportPublishedOnAccount(
  data: InstagramData,
  accountId: string,
  exportId: string,
): boolean {
  return getPublishedExportIdsForAccount(data, accountId).has(exportId);
}

export function getAccountQueuePosts(
  data: InstagramData,
  accountId: string,
): ScheduledPost[] {
  return data.scheduledPosts
    .filter(
      (post) =>
        post.accountId === accountId &&
        post.status === "queued" &&
        inferPostSource(post) === "queue",
    )
    .sort(
      (a, b) =>
        (a.queuePosition ?? Number.MAX_SAFE_INTEGER) -
        (b.queuePosition ?? Number.MAX_SAFE_INTEGER),
    );
}

export function getReservedExportIdsForAccount(
  data: InstagramData,
  accountId: string,
): Set<string> {
  const reserved = new Set<string>();
  for (const post of data.scheduledPosts) {
    if (post.accountId !== accountId) continue;
    if (
      post.status === "queued" ||
      post.status === "scheduled" ||
      post.status === "publishing"
    ) {
      reserved.add(post.exportId);
    }
  }
  return reserved;
}

export function getAvailableExportsForAccount(
  data: InstagramData,
  exports: LibraryExport[],
  accountId: string,
): LibraryExport[] {
  const published = getPublishedExportIdsForAccount(data, accountId);
  const reserved = getReservedExportIdsForAccount(data, accountId);
  return exports
    .filter(
      (exp) =>
        exp.status === "ready" &&
        !published.has(exp.id) &&
        !reserved.has(exp.id),
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}

export function getNextQueuePostForAccount(
  data: InstagramData,
  accountId: string,
): ScheduledPost | null {
  return getAccountQueuePosts(data, accountId)[0] ?? null;
}

export function buildQueueCaption(exp: LibraryExport): string {
  return (
    [exp.overlayText, exp.name].filter(Boolean).join("\n\n") ||
    exp.name ||
    "Hookr"
  );
}

/** Instagram post caption — prefers explicit text, then account default, then export metadata. */
export function resolveScheduleCaption(
  exp: LibraryExport,
  caption?: string | null,
  defaultCaption?: string | null,
): string {
  const explicit = caption?.trim();
  if (explicit) return explicit;

  const accountDefault = defaultCaption?.trim();
  if (accountDefault) return accountDefault;

  return buildQueueCaption(exp);
}

export function nextQueuePosition(data: InstagramData, accountId: string): number {
  const queue = getAccountQueuePosts(data, accountId);
  if (!queue.length) return 0;
  return Math.max(...queue.map((post) => post.queuePosition ?? 0)) + 1;
}
