import { NextResponse } from "next/server";
import {
  AUTO_POST_INTERVAL_HOURS_OPTIONS,
  formatAutoPostInterval,
  getAccountLastPublishedAt,
  getAutoPostIntervalMs,
  getAutoPostQueuePreview,
  getNextEligibleAt,
  isAccountEligibleForAutoPost,
} from "@/lib/instagram-autopost";
import { isInstagramRateLimited } from "@/lib/instagram-errors";
import {
  getAccountQueuePosts,
  getAvailableExportsForAccount,
  getPublishedExportIdsForAccount,
} from "@/lib/instagram-queue";
import {
  getInstagramConfig,
  getPublicMediaBaseUrl,
  isPubliclyReachableMediaUrl,
} from "@/lib/instagram";
import {
  getPostingGoalForAccount,
  POSTING_GOAL_PRESETS,
} from "@/lib/posting-slots";
import {
  publicInstagramAccount,
  readInstagram,
  setAccountPostingGoal,
  setAutoPostSettings,
} from "@/lib/instagram-store";
import { readLibrary } from "@/lib/library-store";
import { formatPgError } from "@/lib/db/connection-url";
import { withQueryTimeout } from "@/lib/db/query-timeout";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const config = getInstagramConfig(request);
    const mediaBase = getPublicMediaBaseUrl();
    const [instagram, library] = await Promise.all([
      withQueryTimeout(readInstagram(), 12_000, "instagram read"),
      readLibrary("exports"),
    ]);

    const exportById = new Map(library.exports.map((exp) => [exp.id, exp]));
    const readyExports = library.exports.filter((exp) => exp.status === "ready");

    const queues = Object.fromEntries(
      instagram.accounts.map((account) => {
        const queue = getAccountQueuePosts(instagram, account.id).map((post) => ({
          ...post,
          exportName:
            post.exportName ||
            exportById.get(post.exportId)?.name ||
            post.exportId,
          exportUrl: exportById.get(post.exportId)?.url ?? null,
        }));
        const available = getAvailableExportsForAccount(
          instagram,
          library.exports,
          account.id,
        );
        const publishedCount = getPublishedExportIdsForAccount(
          instagram,
          account.id,
        ).size;
        return [account.id, { queue, available, publishedCount }];
      }),
    );

    const queuePreview = getAutoPostQueuePreview(instagram, library.exports);
    const intervalMs = getAutoPostIntervalMs(instagram);

    return NextResponse.json({
      configured: config.configured,
      redirectUri: config.redirectUri,
      canPublishMedia: isPubliclyReachableMediaUrl(`${mediaBase}/x`),
      mediaBaseUrl: mediaBase || null,
      accounts: instagram.accounts.map(publicInstagramAccount),
      scheduledPosts: instagram.scheduledPosts.map((post) => ({
        ...post,
        exportName:
          post.exportName || exportById.get(post.exportId)?.name || post.exportId,
        exportUrl: exportById.get(post.exportId)?.url ?? null,
      })),
      exports: readyExports,
      queues,
      postingGoals: Object.fromEntries(
        instagram.accounts.map((account) => [
          account.id,
          getPostingGoalForAccount(instagram.accountPostingGoals, account.id),
        ]),
      ),
      postingGoalPresets: POSTING_GOAL_PRESETS,
      autoPost: {
        enabled: instagram.autoPostEnabled,
        intervalHours: instagram.autoPostIntervalHours,
        intervalOptions: [...AUTO_POST_INTERVAL_HOURS_OPTIONS],
        intervalMs,
        intervalLabel: formatAutoPostInterval(intervalMs),
        next: queuePreview,
        accounts: instagram.accounts.map((account) => ({
          id: account.id,
          username: account.username,
          lastPublishedAt: getAccountLastPublishedAt(instagram, account.id),
          nextEligibleAt: getNextEligibleAt(instagram, account.id),
          canPostNow: isAccountEligibleForAutoPost(instagram, account.id),
          queueLength: getAccountQueuePosts(instagram, account.id).length,
        })),
        rateLimitedUntil: instagram.apiRateLimitedUntil ?? null,
        rateLimitedNow: isInstagramRateLimited(instagram.apiRateLimitedUntil),
      },
    });
  } catch (err) {
    console.error("[instagram] GET failed", err);
    return NextResponse.json(
      { error: formatPgError(err) },
      { status: 503 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      autoPostEnabled?: boolean;
      autoPostIntervalHours?: number;
      accountId?: string;
      postingGoal?: { postsPerDay?: number; slotTimes?: string[] };
    };

    if (
      body.accountId &&
      body.postingGoal &&
      typeof body.postingGoal.postsPerDay === "number"
    ) {
      const goal = await setAccountPostingGoal(body.accountId, {
        postsPerDay: body.postingGoal.postsPerDay,
        slotTimes: body.postingGoal.slotTimes ?? [],
      });
      return NextResponse.json({ postingGoal: goal });
    }

    if (
      typeof body.autoPostEnabled !== "boolean" &&
      body.autoPostIntervalHours === undefined
    ) {
      return NextResponse.json(
        {
          error:
            "Provide postingGoal, autoPostEnabled, and/or autoPostIntervalHours.",
        },
        { status: 400 },
      );
    }

    const updated = await setAutoPostSettings({
      enabled: body.autoPostEnabled,
      intervalHours: body.autoPostIntervalHours,
    });
    return NextResponse.json(updated);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not update settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
