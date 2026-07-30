import type {
  LibraryExport,
  YouTubeData,
  YouTubeScheduledPost,
  ScheduledPostSource,
} from "./types";

export function inferYouTubePostSource(
  post: YouTubeScheduledPost,
): ScheduledPostSource {
  if (post.source) return post.source;
  if (post.id.startsWith("auto-")) return "auto";
  if (post.id.startsWith("queue-") || post.status === "queued") return "queue";
  return "manual";
}

export function getPublishedExportIdsForYouTubeAccount(
  data: YouTubeData,
  accountId: string,
): Set<string> {
  const ids = new Set<string>(data.publishedExportIds);
  for (const post of data.scheduledPosts) {
    if (post.accountId === accountId && post.status === "published") {
      ids.add(post.exportId);
    }
  }
  return ids;
}

export function isExportPublishedOnYouTubeAccount(
  data: YouTubeData,
  accountId: string,
  exportId: string,
): boolean {
  return getPublishedExportIdsForYouTubeAccount(data, accountId).has(exportId);
}

export function getYouTubeAccountQueuePosts(
  data: YouTubeData,
  accountId: string,
): YouTubeScheduledPost[] {
  return data.scheduledPosts
    .filter(
      (post) =>
        post.accountId === accountId &&
        post.status === "queued" &&
        inferYouTubePostSource(post) === "queue",
    )
    .sort(
      (a, b) =>
        (a.queuePosition ?? Number.MAX_SAFE_INTEGER) -
        (b.queuePosition ?? Number.MAX_SAFE_INTEGER),
    );
}

export function getReservedExportIdsForYouTubeAccount(
  data: YouTubeData,
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

export function getAvailableExportsForYouTubeAccount(
  data: YouTubeData,
  exports: LibraryExport[],
  accountId: string,
): LibraryExport[] {
  const published = getPublishedExportIdsForYouTubeAccount(data, accountId);
  const reserved = getReservedExportIdsForYouTubeAccount(data, accountId);
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

export function buildYouTubeQueueDescription(exp: LibraryExport): string {
  return (
    [exp.overlayText, exp.name].filter(Boolean).join("\n\n") ||
    exp.name ||
    "Hookr"
  );
}

export function resolveYouTubeScheduleText(
  exp: LibraryExport,
  caption?: string | null,
  defaultCaption?: string | null,
): { title: string; description: string } {
  const explicit = caption?.trim();
  const accountDefault = defaultCaption?.trim();
  const description = explicit || accountDefault || buildYouTubeQueueDescription(exp);
  const titleLine = description.split("\n")[0]?.trim() || exp.name || "Hookr Short";
  return {
    title: titleLine.slice(0, 100),
    description,
  };
}

export function nextYouTubeQueuePosition(
  data: YouTubeData,
  accountId: string,
): number {
  const queue = getYouTubeAccountQueuePosts(data, accountId);
  if (!queue.length) return 0;
  return Math.max(...queue.map((post) => post.queuePosition ?? 0)) + 1;
}

export function resolveScheduleDescription(
  exp: LibraryExport,
  caption?: string | null,
  defaultCaption?: string | null,
): string {
  return resolveYouTubeScheduleText(exp, caption, defaultCaption).description;
}

export function resolveScheduleTitle(
  exp: LibraryExport,
  caption?: string | null,
  defaultCaption?: string | null,
): string {
  return resolveYouTubeScheduleText(exp, caption, defaultCaption).title;
}
