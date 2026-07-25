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
  getInstagramConfig,
  getPublicMediaBaseUrl,
  isPubliclyReachableMediaUrl,
} from "@/lib/instagram";
import {
  publicInstagramAccount,
  readInstagram,
  setAutoPostSettings,
} from "@/lib/instagram-store";
import { readLibrary } from "@/lib/library-store";
import { formatPgError } from "@/lib/db/connection-url";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const config = getInstagramConfig(request);
    const mediaBase = getPublicMediaBaseUrl();
    const instagram = await readInstagram();
    const library = await readLibrary("exports");

  const published = new Set(instagram.publishedExportIds);
  const exportById = new Map(library.exports.map((exp) => [exp.id, exp]));
  const unpublishedCount = library.exports.filter(
    (exp) => exp.status === "ready" && !published.has(exp.id),
  ).length;
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
    })),
    publishedExportIds: instagram.publishedExportIds,
    exports: library.exports.filter(
      (exp) => exp.status === "ready" && !published.has(exp.id),
    ),
    autoPost: {
      enabled: instagram.autoPostEnabled,
      intervalHours: instagram.autoPostIntervalHours,
      intervalOptions: [...AUTO_POST_INTERVAL_HOURS_OPTIONS],
      intervalMs,
      intervalLabel: formatAutoPostInterval(intervalMs),
      unpublishedCount,
      next: queuePreview,
      accounts: instagram.accounts.map((account) => ({
        id: account.id,
        username: account.username,
        lastPublishedAt: getAccountLastPublishedAt(instagram, account.id),
        nextEligibleAt: getNextEligibleAt(instagram, account.id),
        canPostNow: isAccountEligibleForAutoPost(instagram, account.id),
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
    };

    if (
      typeof body.autoPostEnabled !== "boolean" &&
      body.autoPostIntervalHours === undefined
    ) {
      return NextResponse.json(
        {
          error:
            "Provide autoPostEnabled and/or autoPostIntervalHours (4, 5, or 6).",
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
