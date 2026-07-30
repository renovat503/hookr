import { NextResponse } from "next/server";
import { getActiveCampaignId } from "@/lib/active-campaign";
import {
  getYouTubeAccountQueuePosts,
  getAvailableExportsForYouTubeAccount,
  getPublishedExportIdsForYouTubeAccount,
} from "@/lib/youtube-queue";
import { getYouTubeConfig } from "@/lib/youtube";
import {
  getPostingGoalForAccount,
  POSTING_GOAL_PRESETS,
} from "@/lib/posting-slots";
import {
  publicYouTubeAccount,
  readYouTube,
  setYouTubeAccountPostingGoal,
} from "@/lib/youtube-store";
import { readLibrary } from "@/lib/library-store";
import { formatPgError } from "@/lib/db/connection-url";
import { withQueryTimeout } from "@/lib/db/query-timeout";

export const runtime = "nodejs";

function isYouTubeQuotaExhausted(until?: string | null) {
  return Boolean(until && new Date(until).getTime() > Date.now());
}

export async function GET(request: Request) {
  try {
    const config = getYouTubeConfig(request);
    const campaignId = await getActiveCampaignId();
    const [youtube, library] = await Promise.all([
      withQueryTimeout(readYouTube(campaignId), 20_000, "youtube read"),
      readLibrary("exports", { campaignId }),
    ]);

    const exportById = new Map(library.exports.map((exp) => [exp.id, exp]));
    const readyExports = library.exports.filter((exp) => exp.status === "ready");

    const queues = Object.fromEntries(
      youtube.accounts.map((account) => {
        const queue = getYouTubeAccountQueuePosts(youtube, account.id).map(
          (post) => ({
            ...post,
            exportName:
              post.exportName ||
              exportById.get(post.exportId)?.name ||
              post.exportId,
            exportUrl: exportById.get(post.exportId)?.url ?? null,
          }),
        );
        const available = getAvailableExportsForYouTubeAccount(
          youtube,
          library.exports,
          account.id,
        );
        const publishedCount = getPublishedExportIdsForYouTubeAccount(
          youtube,
          account.id,
        ).size;
        return [account.id, { queue, available, publishedCount }];
      }),
    );

    return NextResponse.json({
      configured: config.configured,
      redirectUri: config.redirectUri,
      accounts: youtube.accounts.map(publicYouTubeAccount),
      scheduledPosts: youtube.scheduledPosts.map((post) => ({
        ...post,
        exportName:
          post.exportName || exportById.get(post.exportId)?.name || post.exportId,
        exportUrl: exportById.get(post.exportId)?.url ?? null,
      })),
      exports: readyExports,
      queues,
      postingGoals: Object.fromEntries(
        youtube.accounts.map((account) => [
          account.id,
          getPostingGoalForAccount(youtube.accountPostingGoals, account.id),
        ]),
      ),
      postingGoalPresets: POSTING_GOAL_PRESETS,
      quotaExhaustedUntil: youtube.quotaExhaustedUntil ?? null,
      quotaExhaustedNow: isYouTubeQuotaExhausted(youtube.quotaExhaustedUntil),
    });
  } catch (err) {
    console.error("[youtube] GET failed", err);
    return NextResponse.json({ error: formatPgError(err) }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      accountId?: string;
      postingGoal?: { postsPerDay?: number; slotTimes?: string[] };
    };

    if (
      !body.accountId ||
      !body.postingGoal ||
      typeof body.postingGoal.postsPerDay !== "number"
    ) {
      return NextResponse.json(
        { error: "Provide accountId and postingGoal." },
        { status: 400 },
      );
    }

    const goal = await setYouTubeAccountPostingGoal(body.accountId, {
      postsPerDay: body.postingGoal.postsPerDay,
      slotTimes: body.postingGoal.slotTimes ?? [],
    });
    return NextResponse.json({ postingGoal: goal });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not update settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
