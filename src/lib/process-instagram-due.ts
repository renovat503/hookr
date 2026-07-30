import {
  formatInstagramError,
  getInstagramRateLimitBackoffMs,
  isInstagramRateLimitError,
  isInstagramRateLimited,
} from "@/lib/instagram-errors";
import { inferPostSource } from "@/lib/instagram-queue";
import {
  publishReelFromLocalFile,
  toPublicVideoUrl,
} from "@/lib/instagram";
import { resolveToLocalPath } from "@/lib/storage/media";
import { purgePublishedExport } from "@/lib/purge-published-export";
import {
  isExportPublishedOnAccount,
  purgeExportFromInstagram,
  readInstagramAll,
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
  rateLimited?: boolean;
};

export type ProcessDueResult = {
  processed: number;
  results: ProcessResult[];
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
    await recordAccountPublished(post.accountId, publishedAt);

    try {
      await purgePublishedExport(post.exportId, exp.url);
    } catch (err) {
      console.error("[instagram] purge after publish failed", post.exportId, err);
      await purgeExportFromInstagram(post.exportId).catch(() => undefined);
    }

    return {
      id: post.id,
      ok: true,
      mediaId: published.mediaId,
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Publish failed.";
    const message = formatInstagramError(raw);
    const rateLimited = isInstagramRateLimitError(raw);
    const isLegacyAuto =
      inferPostSource(post) === "auto" || post.id.startsWith("auto-");

    if (rateLimited) {
      await setApiRateLimitedUntil(
        new Date(Date.now() + getInstagramRateLimitBackoffMs()).toISOString(),
      );
    }

    if (isLegacyAuto && rateLimited) {
      await removeScheduledPost(post.id);
      return {
        id: post.id,
        ok: false,
        error: message,
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
      rateLimited,
    };
  }
}

/** Publish calendar posts whose scheduled time has passed. */
export async function processInstagramDue(options?: {
  id?: string;
}): Promise<ProcessDueResult> {
  if (processing) {
    return { processed: 0, results: [], skipped: true };
  }

  processing = true;
  try {
    const instagram = await readInstagramAll();
    if (isInstagramRateLimited(instagram.apiRateLimitedUntil)) {
      return {
        processed: 0,
        results: [],
        skipped: true,
        rateLimitedUntil: instagram.apiRateLimitedUntil ?? null,
      };
    }

    const library = await readLibrary("exports");
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

    return {
      processed: results.length,
      results,
      rateLimitedUntil: instagram.apiRateLimitedUntil ?? null,
    };
  } finally {
    processing = false;
  }
}
