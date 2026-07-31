import { startOfDay } from "@/lib/calendar-utils";
import type { YouTubeScheduledPost } from "@/lib/types";

/** YouTube default API quota allows roughly six uploads per day. */
export const YOUTUBE_DAILY_UPLOAD_LIMIT = 6;

export function isYouTubeQuotaError(message: string): boolean {
  return /quota|dailyLimitExceeded|uploadLimitExceeded/i.test(message);
}

export type YouTubeUploadStats = {
  dailyLimit: number;
  uploadsToday: number;
  uploadsRemainingToday: number;
  dueNow: number;
  scheduledLocally: number;
  uploadedWaitingPublish: number;
  failed: number;
  quotaExhaustedUntil: string | null;
  quotaExhaustedNow: boolean;
};

export function isYouTubeQuotaExhausted(until?: string | null): boolean {
  return Boolean(until && new Date(until).getTime() > Date.now());
}

/** True when the scheduled publish time has arrived (or passed). */
export function isYouTubePublishDue(
  scheduledAt: string,
  now = Date.now(),
): boolean {
  return new Date(scheduledAt).getTime() <= now;
}

export function isYouTubeUploadDue(post: YouTubeScheduledPost): boolean {
  if (post.status !== "scheduled" || post.youtubeVideoId) return false;
  return isYouTubePublishDue(post.scheduledAt);
}

export function isYouTubeQuotaFailure(post: YouTubeScheduledPost): boolean {
  return (
    post.status === "failed" &&
    Boolean(post.error && isYouTubeQuotaError(post.error)) &&
    !post.youtubeVideoId
  );
}

export function countYouTubeUploadsToday(
  posts: YouTubeScheduledPost[],
  accountId: string,
  now = new Date(),
): number {
  const dayStart = startOfDay(now).getTime();
  return posts.filter((post) => {
    if (post.accountId !== accountId || !post.uploadedAt) return false;
    return new Date(post.uploadedAt).getTime() >= dayStart;
  }).length;
}

export function getYouTubeUploadStatsForAccount(
  posts: YouTubeScheduledPost[],
  accountId: string,
  quotaExhaustedUntil?: string | null,
): YouTubeUploadStats {
  const accountPosts = posts.filter((post) => post.accountId === accountId);
  const uploadsToday = countYouTubeUploadsToday(accountPosts, accountId);
  const dueNow = accountPosts.filter(isYouTubeUploadDue).length;
  const scheduledLocally = accountPosts.filter(
    (post) =>
      post.status === "scheduled" &&
      !post.youtubeVideoId &&
      !isYouTubePublishDue(post.scheduledAt),
  ).length;
  const uploadedWaitingPublish = accountPosts.filter(
    (post) => post.status === "scheduled" && Boolean(post.youtubeVideoId),
  ).length;
  const failed = accountPosts.filter((post) => post.status === "failed").length;
  const quotaExhaustedNow = isYouTubeQuotaExhausted(quotaExhaustedUntil);

  return {
    dailyLimit: YOUTUBE_DAILY_UPLOAD_LIMIT,
    uploadsToday,
    uploadsRemainingToday: Math.max(0, YOUTUBE_DAILY_UPLOAD_LIMIT - uploadsToday),
    dueNow,
    scheduledLocally,
    uploadedWaitingPublish,
    failed,
    quotaExhaustedUntil: quotaExhaustedUntil ?? null,
    quotaExhaustedNow,
  };
}

export function formatYouTubeUploadStatusMessage(
  stats: YouTubeUploadStats,
): string {
  if (stats.quotaExhaustedNow && stats.quotaExhaustedUntil) {
    const retryAt = new Date(stats.quotaExhaustedUntil).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return `YouTube upload quota reached. Hookr will retry failed uploads after ${retryAt}.`;
  }

  const parts = [
    "Posts stay on the Hookr calendar until their scheduled time, then upload to YouTube as public.",
    `YouTube allows about ${stats.dailyLimit} uploads per day`,
    `Today: ${stats.uploadsToday}/${stats.dailyLimit} uploaded`,
  ];

  if (stats.scheduledLocally > 0) {
    parts.push(`${stats.scheduledLocally} scheduled locally`);
  }
  if (stats.dueNow > 0) {
    parts.push(`${stats.dueNow} ready to upload now`);
  }
  if (stats.uploadedWaitingPublish > 0) {
    parts.push(`${stats.uploadedWaitingPublish} legacy uploads waiting to go public`);
  }
  if (stats.failed > 0) {
    parts.push(`${stats.failed} failed (quota failures retry automatically)`);
  }

  return parts.join(" · ");
}

export function formatYouTubeBulkScheduleNotice(
  count: number,
  stats: YouTubeUploadStats,
): string {
  const daysNeeded = Math.ceil(count / stats.dailyLimit);
  return `Bulk schedule fills the calendar locally only — nothing uploads to YouTube until each slot's time. At about ${stats.dailyLimit} uploads per day, ${count} video${count === 1 ? "" : "s"} need roughly ${daysNeeded} day${daysNeeded === 1 ? "" : "s"} of publish times.`;
}
