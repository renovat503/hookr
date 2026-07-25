import {
  buildAutoPostCaption,
  getAutoPostIntervalMs,
  isAccountEligibleForAutoPost,
  pickOldestUnpublishedExportForAccount,
} from "@/lib/instagram-autopost";
import {
  formatInstagramError,
  getInstagramRateLimitBackoffMs,
  isInstagramRateLimitError,
  isInstagramRateLimited,
} from "@/lib/instagram-errors";
import {
  getNextQueuePostForAccount,
  inferPostSource,
} from "@/lib/instagram-queue";
import {
  publishReelFromLocalFile,
  toPublicVideoUrl,
} from "@/lib/instagram";
import { resolveToLocalPath } from "@/lib/storage/media";
import {
  addScheduledPost,
  isExportPublishedOnAccount,
  markExportPublishedOnAccount,
  readInstagram,
  recordAccountPublished,
  removeScheduledPost,
  setApiRateLimitedUntil,
  updateScheduledPost,
} from "@/lib/instagram-store";
import { readLibrary } from "@/lib/library-store";
import type {
  InstagramAccount,
  InstagramData,
  LibraryExport,
  ScheduledPost,
} from "@/lib/types";

export type ProcessResult = {
  id: string;
  ok: boolean;
  mediaId?: string;
  error?: string;
  auto?: boolean;
  rateLimited?: boolean;
};

export type ProcessDueResult = {
  processed: number;
  results: ProcessResult[];
  autoPostIntervalMs: number;
  skipped?: boolean;
  rateLimitedUntil?: string | null;
};

let processing = false;

async function publishScheduledPost(
  instagram: InstagramData,
  post: ScheduledPost,
  account: InstagramAccount,
  exp: LibraryExport,
): Promise<ProcessResult> {
  if (isExportPublishedOnAccount(instagram, post.accountId, post.exportId)) {
    await updateScheduledPost(post.id, {
      status: "cancelled",
      error: "Video already published on this account",
    });
    return {
      id: post.id,
      ok: false,
      error: "Video already published on this account",
      auto: inferPostSource(post) === "auto",
    };
  }

  await updateScheduledPost(post.id, {
    status: "publishing",
    error: null,
  });

  try {
    const publicVideoUrl = toPublicVideoUrl(exp.url);
    const videoPath = await resolveToLocalPath(exp.url);
    const published = await publishReelFromLocalFile({
      igUserId: account.igUserId,
      accessToken: account.accessToken,
      videoPath,
      caption: post.caption,
      publicVideoUrl,
    });

    const publishedAt = new Date().toISOString();
    await updateScheduledPost(post.id, {
      status: "published",
      publishedAt,
      publishedMediaId: published.mediaId,
      exportName: post.exportName || exp.name,
      error: null,
    });
    await markExportPublishedOnAccount(post.accountId, post.exportId);
    await recordAccountPublished(post.accountId, publishedAt);

    if (!instagram.publishedExportIds.includes(post.exportId)) {
      instagram.publishedExportIds.push(post.exportId);
    }

    return {
      id: post.id,
      ok: true,
      mediaId: published.mediaId,
      auto: inferPostSource(post) === "auto",
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Publish failed.";
    const message = formatInstagramError(raw);
    const rateLimited = isInstagramRateLimitError(raw);
    const isAuto = inferPostSource(post) === "auto";

    if (rateLimited) {
      await setApiRateLimitedUntil(
        new Date(Date.now() + getInstagramRateLimitBackoffMs()).toISOString(),
      );
    }

    if (isAuto && rateLimited) {
      await removeScheduledPost(post.id);
      return {
        id: post.id,
        ok: false,
        error: message,
        auto: true,
        rateLimited: true,
      };
    }

    await updateScheduledPost(post.id, {
      status: "failed",
      error: message,
    });
    return {
      id: post.id,
      ok: false,
      error: message,
      auto: isAuto,
      rateLimited,
    };
  }
}

async function runAutoPostPass(
  instagram: InstagramData,
  library: Awaited<ReturnType<typeof readLibrary>>,
): Promise<ProcessResult[]> {
  if (!instagram.autoPostEnabled || !instagram.accounts.length) {
    return [];
  }

  if (isInstagramRateLimited(instagram.apiRateLimitedUntil)) {
    return [];
  }

  const results: ProcessResult[] = [];

  for (const account of instagram.accounts) {
    if (!isAccountEligibleForAutoPost(instagram, account.id)) {
      continue;
    }

    const queued = getNextQueuePostForAccount(instagram, account.id);
    let post = queued;
    let exp =
      library.exports.find((item) => item.id === queued?.exportId) ?? null;

    if (!post) {
      const fallback = pickOldestUnpublishedExportForAccount(
        library.exports,
        instagram,
        account.id,
      );
      if (!fallback) continue;

      post = {
        id: `auto-${Date.now()}-${account.id}`,
        accountId: account.id,
        exportId: fallback.id,
        exportName: fallback.name,
        caption: buildAutoPostCaption(fallback),
        scheduledAt: new Date().toISOString(),
        status: "scheduled",
        source: "auto",
        createdAt: new Date().toISOString(),
      };
      exp = fallback;
      await addScheduledPost(post);
      instagram.scheduledPosts.unshift(post);
    }

    if (!exp) continue;

    const result = await publishScheduledPost(instagram, post, account, exp);
    results.push(result);
    break;
  }

  return results;
}

/** Publish due scheduled posts, then run auto-post for eligible accounts. */
export async function processInstagramDue(options?: {
  id?: string;
}): Promise<ProcessDueResult> {
  if (processing) {
    const instagram = await readInstagram();
    return {
      processed: 0,
      results: [],
      autoPostIntervalMs: getAutoPostIntervalMs(instagram),
      skipped: true,
    };
  }

  processing = true;
  try {
    let instagram = await readInstagram();
    if (isInstagramRateLimited(instagram.apiRateLimitedUntil)) {
      return {
        processed: 0,
        results: [],
        autoPostIntervalMs: getAutoPostIntervalMs(instagram),
        skipped: true,
        rateLimitedUntil: instagram.apiRateLimitedUntil ?? null,
      };
    }

    const library = await readLibrary();
    const now = Date.now();

    const due = instagram.scheduledPosts.filter((post) => {
      if (options?.id) return post.id === options.id;
      if (inferPostSource(post) === "auto") return false;
      if (post.status !== "scheduled") return false;
      return new Date(post.scheduledAt).getTime() <= now;
    });

    const results: ProcessResult[] = [];

    for (const post of due) {
      const account = instagram.accounts.find((a) => a.id === post.accountId);
      const exp = library.exports.find((e) => e.id === post.exportId);

      if (!account) {
        await updateScheduledPost(post.id, {
          status: "failed",
          error: "Instagram account missing.",
        });
        results.push({ id: post.id, ok: false, error: "Account missing" });
        continue;
      }

      if (!exp) {
        await updateScheduledPost(post.id, {
          status: "failed",
          error: "Finished video missing.",
        });
        results.push({ id: post.id, ok: false, error: "Export missing" });
        continue;
      }

      const result = await publishScheduledPost(
        instagram,
        post,
        account,
        exp,
      );
      results.push(result);
    }

    if (!options?.id) {
      instagram = await readInstagram();
      const autoResults = await runAutoPostPass(instagram, library);
      results.push(...autoResults);
    }

    return {
      processed: results.length,
      results,
      autoPostIntervalMs: getAutoPostIntervalMs(instagram),
      rateLimitedUntil: instagram.apiRateLimitedUntil ?? null,
    };
  } finally {
    processing = false;
  }
}
