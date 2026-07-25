import {
  buildAutoPostCaption,
  getAutoPostIntervalMs,
  getReservedExportIds,
  isAccountEligibleForAutoPost,
  pickOldestUnpublishedExport,
} from "@/lib/instagram-autopost";
import {
  formatInstagramError,
  getInstagramRateLimitBackoffMs,
  isInstagramRateLimitError,
  isInstagramRateLimited,
} from "@/lib/instagram-errors";
import {
  publishReelFromLocalFile,
  toPublicVideoUrl,
} from "@/lib/instagram";
import { resolveToLocalPath } from "@/lib/storage/media";
import {
  addScheduledPost,
  isExportPublished,
  markExportPublished,
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
  if (isExportPublished(instagram, post.exportId)) {
    await updateScheduledPost(post.id, {
      status: "cancelled",
      error: "Video already published",
    });
    return {
      id: post.id,
      ok: false,
      error: "Video already published",
      auto: post.id.startsWith("auto-"),
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
    await markExportPublished(post.exportId);
    await recordAccountPublished(post.accountId, publishedAt);

    instagram.publishedExportIds = [
      ...new Set([...instagram.publishedExportIds, post.exportId]),
    ];

    return {
      id: post.id,
      ok: true,
      mediaId: published.mediaId,
      auto: post.id.startsWith("auto-"),
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Publish failed.";
    const message = formatInstagramError(raw);
    const rateLimited = isInstagramRateLimitError(raw);
    const isAuto = post.id.startsWith("auto-");

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
  const published = new Set(instagram.publishedExportIds);
  const reserved = getReservedExportIds(instagram);

  // One auto-post attempt per tick to avoid hammering Instagram's API.
  for (const account of instagram.accounts) {
    if (!isAccountEligibleForAutoPost(instagram, account.id)) {
      continue;
    }

    const exp = pickOldestUnpublishedExport(
      library.exports,
      published,
      reserved,
    );
    if (!exp) break;

    reserved.add(exp.id);

    const post: ScheduledPost = {
      id: `auto-${Date.now()}-${account.id}`,
      accountId: account.id,
      exportId: exp.id,
      exportName: exp.name,
      caption: buildAutoPostCaption(exp),
      scheduledAt: new Date().toISOString(),
      status: "scheduled",
      createdAt: new Date().toISOString(),
    };

    await addScheduledPost(post);
    instagram.scheduledPosts.unshift(post);

    const result = await publishScheduledPost(instagram, post, account, exp);
    results.push(result);

    if (result.ok) {
      published.add(exp.id);
    }

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
      if (post.id.startsWith("auto-")) return false;
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
