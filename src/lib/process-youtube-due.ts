import { resolveToLocalPath } from "@/lib/storage/media";
import {
  ensureFreshAccessToken,
  getYouTubeVideoStatus,
  uploadYouTubeVideo,
} from "@/lib/youtube";
import {
  countYouTubeUploadsToday,
  isYouTubeQuotaError,
  isYouTubeQuotaExhausted,
  isYouTubeQuotaFailure,
  isYouTubeUploadDue,
  YOUTUBE_DAILY_UPLOAD_LIMIT,
} from "@/lib/youtube-upload-policy";
import { inferYouTubePostSource } from "@/lib/youtube-queue";
import { purgePublishedExportIfUnused } from "@/lib/purge-published-export";
import {
  isExportPublishedOnYouTubeAccount,
  markYouTubeExportPublished,
  readYouTubeAll,
  recordYouTubeAccountPublished,
  setYouTubeQuotaExhaustedUntil,
  updateYouTubeAccountTokens,
  updateYouTubeScheduledPost,
} from "@/lib/youtube-store";
import { readLibrary } from "@/lib/library-store";
import type {
  LibraryExport,
  YouTubeAccount,
  YouTubeData,
  YouTubeScheduledPost,
} from "@/lib/types";

export type ProcessResult = {
  id: string;
  ok: boolean;
  videoId?: string;
  error?: string;
  quotaExhausted?: boolean;
};

export type ProcessDueResult = {
  processed: number;
  results: ProcessResult[];
  skipped?: boolean;
  quotaExhaustedUntil?: string | null;
  retriedFailed?: number;
};

let processing = false;

async function getFreshAccount(account: YouTubeAccount): Promise<YouTubeAccount> {
  const accessToken = await ensureFreshAccessToken(account, async (patch) => {
    await updateYouTubeAccountTokens(account.id, patch);
    account.accessToken = patch.accessToken;
    if (patch.tokenExpiresAt) account.tokenExpiresAt = patch.tokenExpiresAt;
  });
  return { ...account, accessToken };
}

async function resetQuotaFailedPosts(
  youtube: YouTubeData,
): Promise<number> {
  if (isYouTubeQuotaExhausted(youtube.quotaExhaustedUntil)) {
    return 0;
  }

  let reset = 0;
  for (const post of youtube.scheduledPosts) {
    if (!isYouTubeQuotaFailure(post)) continue;
    await updateYouTubeScheduledPost(post.id, {
      status: "scheduled",
      error: null,
    });
    reset += 1;
  }

  if (reset > 0) {
    await setYouTubeQuotaExhaustedUntil(null);
  }

  return reset;
}

async function uploadScheduledPost(
  youtube: YouTubeData,
  post: YouTubeScheduledPost,
  account: YouTubeAccount,
  exp: LibraryExport,
): Promise<ProcessResult> {
  if (isExportPublishedOnYouTubeAccount(youtube, post.accountId, post.exportId)) {
    await updateYouTubeScheduledPost(post.id, {
      status: "cancelled",
      error: "Video already published on this channel",
    });
    return {
      id: post.id,
      ok: false,
      error: "Video already published on this channel",
    };
  }

  await updateYouTubeScheduledPost(post.id, {
    status: "publishing",
    error: null,
  });

  try {
    const freshAccount = await getFreshAccount(account);
    const videoPath = await resolveToLocalPath(exp.url);
    const uploaded = await uploadYouTubeVideo({
      accessToken: freshAccount.accessToken,
      videoPath,
      title: post.title,
      description: post.description,
      publishNow: true,
    });

    const uploadedAt = new Date().toISOString();
    await updateYouTubeScheduledPost(post.id, {
      youtubeVideoId: uploaded.videoId,
      uploadedAt,
      status: "published",
      publishedAt: uploadedAt,
      error: null,
    });

    await recordYouTubeAccountPublished(post.accountId, uploadedAt);
    if (post.campaignId) {
      await markYouTubeExportPublished(post.exportId, post.campaignId);
    }
    try {
      await purgePublishedExportIfUnused(post.exportId, exp.url);
    } catch (err) {
      console.error("[youtube] purge after publish failed", post.exportId, err);
    }

    return {
      id: post.id,
      ok: true,
      videoId: uploaded.videoId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "YouTube upload failed.";
    const quotaExhausted = isYouTubeQuotaError(message);

    if (quotaExhausted) {
      await setYouTubeQuotaExhaustedUntil(
        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      );
    }

    await updateYouTubeScheduledPost(post.id, {
      status: "failed",
      error: message,
    });
    return {
      id: post.id,
      ok: false,
      error: message,
      quotaExhausted,
    };
  }
}

/** Legacy posts uploaded early with YouTube publishAt — finalize when time arrives. */
async function finalizePublishedPost(
  post: YouTubeScheduledPost,
  account: YouTubeAccount,
  exp: LibraryExport,
): Promise<ProcessResult> {
  if (!post.youtubeVideoId) {
    return { id: post.id, ok: false, error: "Missing YouTube video id." };
  }

  try {
    const freshAccount = await getFreshAccount(account);
    const status = await getYouTubeVideoStatus(
      freshAccount.accessToken,
      post.youtubeVideoId,
    );
    const isPublic =
      status.privacyStatus === "public" ||
      status.uploadStatus === "processed";

    if (!isPublic && new Date(post.scheduledAt).getTime() > Date.now()) {
      return { id: post.id, ok: true, videoId: post.youtubeVideoId };
    }

    const publishedAt = new Date().toISOString();
    await updateYouTubeScheduledPost(post.id, {
      status: "published",
      publishedAt,
      error: null,
    });
    await recordYouTubeAccountPublished(post.accountId, publishedAt);
    if (post.campaignId) {
      await markYouTubeExportPublished(post.exportId, post.campaignId);
    }
    try {
      await purgePublishedExportIfUnused(post.exportId, exp.url);
    } catch (err) {
      console.error("[youtube] purge after publish failed", post.exportId, err);
    }

    return { id: post.id, ok: true, videoId: post.youtubeVideoId };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not verify YouTube publish.";
    await updateYouTubeScheduledPost(post.id, {
      status: "failed",
      error: message,
    });
    return { id: post.id, ok: false, error: message };
  }
}

function pendingUploadPosts(
  youtube: YouTubeData,
  id?: string,
): YouTubeScheduledPost[] {
  return youtube.scheduledPosts
    .filter((post) => {
      if (id) return post.id === id;
      if (inferYouTubePostSource(post) === "auto") return false;
      return isYouTubeUploadDue(post);
    })
    .sort(
      (a, b) =>
        new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    );
}

export async function processYouTubeDue(options?: {
  id?: string;
}): Promise<ProcessDueResult> {
  if (processing) {
    return { processed: 0, results: [], skipped: true };
  }

  processing = true;
  try {
    let youtube = await readYouTubeAll();
    const retriedFailed = await resetQuotaFailedPosts(youtube);
    if (retriedFailed > 0) {
      youtube = await readYouTubeAll();
    }

    if (isYouTubeQuotaExhausted(youtube.quotaExhaustedUntil)) {
      return {
        processed: 0,
        results: [],
        skipped: true,
        quotaExhaustedUntil: youtube.quotaExhaustedUntil ?? null,
        retriedFailed,
      };
    }

    const library = await readLibrary("exports");
    const results: ProcessResult[] = [];
    const uploadsTodayByAccount = new Map<string, number>();

    for (const post of pendingUploadPosts(youtube, options?.id)) {
      const uploadsToday =
        uploadsTodayByAccount.get(post.accountId) ??
        countYouTubeUploadsToday(youtube.scheduledPosts, post.accountId);
      if (uploadsToday >= YOUTUBE_DAILY_UPLOAD_LIMIT) {
        continue;
      }

      const account = youtube.accounts.find((a) => a.id === post.accountId);
      const exp = library.exports.find((e) => e.id === post.exportId);
      if (!account) {
        await updateYouTubeScheduledPost(post.id, {
          status: "failed",
          error: "YouTube account missing.",
        });
        results.push({ id: post.id, ok: false, error: "Account missing" });
        continue;
      }
      if (!exp) {
        await updateYouTubeScheduledPost(post.id, {
          status: "failed",
          error: "Finished video missing.",
        });
        results.push({ id: post.id, ok: false, error: "Export missing" });
        continue;
      }

      const result = await uploadScheduledPost(youtube, post, account, exp);
      results.push(result);
      if (result.ok) {
        uploadsTodayByAccount.set(post.accountId, uploadsToday + 1);
      }
      if (result.quotaExhausted) {
        break;
      }
    }

    youtube = await readYouTubeAll();
    const pendingFinalize = youtube.scheduledPosts.filter((post) => {
      if (options?.id) return post.id === options.id;
      if (inferYouTubePostSource(post) === "auto") return false;
      return (
        post.status === "scheduled" &&
        Boolean(post.youtubeVideoId) &&
        new Date(post.scheduledAt).getTime() <= Date.now()
      );
    });

    for (const post of pendingFinalize) {
      const account = youtube.accounts.find((a) => a.id === post.accountId);
      const exp = library.exports.find((e) => e.id === post.exportId);
      if (!account || !exp) continue;
      results.push(await finalizePublishedPost(post, account, exp));
    }

    return {
      processed: results.length,
      results,
      quotaExhaustedUntil: youtube.quotaExhaustedUntil ?? null,
      retriedFailed,
    };
  } finally {
    processing = false;
  }
}
