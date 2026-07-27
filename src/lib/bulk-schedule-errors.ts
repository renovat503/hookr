export type BulkScheduleSkip = {
  exportId: string;
  reason: string;
};

export function summarizeBulkScheduleSkips(
  skipped: BulkScheduleSkip[],
): string[] {
  const counts = new Map<string, number>();
  for (const item of skipped) {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count} video${count === 1 ? "" : "s"} — ${reason}`);
}

export function formatBulkScheduleFailure(
  skipped: BulkScheduleSkip[],
  fallback = "No videos could be scheduled.",
): string {
  if (!skipped.length) return fallback;
  const summary = summarizeBulkScheduleSkips(skipped).join("; ");
  return `${fallback} ${summary}`;
}
