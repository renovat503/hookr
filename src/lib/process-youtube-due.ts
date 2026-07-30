import { resolveToLocalPath } from "@/lib/storage/media";
import {
  ensureFreshAccessToken,
  getYouTubeVideoStatus,
  isYouTubeQuotaError,
  uploadYouTubeVideo,
} from "@/lib/youtube";
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
};

let processing = false;

function isYouTubeQuotaExhausted(until?: string | null) {
  return Boolean(until && new Date(until).getTime() > Date.now());
}

async function getFreshAccount(account: YouTubeAccount): Promise<YouTubeAccount> {
  const accessToken = await ensureFreshAccessToken(account, async (patch) => {
    await updateYouTubeAccountTokens(account.id, patch);
    account.accessToken = patch.accessToken;
    if (patch.tokenExpiresAt) account.tokenExpiresAt = patch.tokenExpiresAt;
  });
  return { ...account, accessToken };
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
    const publishNow = new Date(post.scheduledAt).getTime() <= Date.now();
    const uploaded = await uploadYouTubeVideo({
      accessToken: freshAccount.accessToken,
      videoPath,
      title: post.title,
      description: post.description,
      publishAt: publishNow ? null : post.scheduledAt,
      publishNow,
    });

    const publishedAt = new Date().toISOString();
    await updateYouTubeScheduledPost(post.id, {
      youtubeVideoId: uploaded.videoId,
      status: publishNow ? "published" : "scheduled",
      publishedAt: publishNow ? publishedAt : null,
      error: null,
    });

    if (publishNow) {
      await recordYouTubeAccountPublished(post.accountId, publishedAt);
      if (post.campaignId) {
        await markYouTubeExportPublished(post.exportId, post.campaignId);
      }
      try {
        await purgePublishedExportIfUnused(post.exportId, exp.url);
      } catch (err) {
        console.error("[youtube] purge after publish failed", post.exportId, err);
      }
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

export async function processYouTubeDue(options?: {
  id?: string;
}): Promise<ProcessDueResult> {
  if (processing) {
    return { processed: 0, results: [], skipped: true };
  }

  processing = true;
  try {
    const youtube = await readYouTubeAll();
    if (isYouTubeQuotaExhausted(youtube.quotaExhaustedUntil)) {
      return {
        processed: 0,
        results: [],
        skipped: true,
        quotaExhaustedUntil: youtube.quotaExhaustedUntil ?? null,
      };
    }

    const library = await readLibrary("exports");
    const results: ProcessResult[] = [];

    const pendingUpload = youtube.scheduledPosts.filter((post) => {
      if (options?.id) return post.id === options.id;
      if (inferYouTubePostSource(post) === "auto") return false;
      return post.status === "scheduled" && !post.youtubeVideoId;
    });

    for (const post of pendingUpload) {
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
      results.push(await uploadScheduledPost(youtube, post, account, exp));
    }

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
    };
  } finally {
    processing = false;
  }
}
