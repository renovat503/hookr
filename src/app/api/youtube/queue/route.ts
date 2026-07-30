import { NextResponse } from "next/server";
import { getActiveCampaignId } from "@/lib/active-campaign";
import {
  addYouTubeScheduledPost,
  isExportPublishedOnYouTubeAccount,
  readYouTube,
  reorderYouTubeAccountQueue,
  updateYouTubeScheduledPost,
} from "@/lib/youtube-store";
import {
  getYouTubeAccountQueuePosts,
  getAvailableExportsForYouTubeAccount,
  getReservedExportIdsForYouTubeAccount,
  nextYouTubeQueuePosition,
  resolveYouTubeScheduleText,
} from "@/lib/youtube-queue";
import { readLibrary } from "@/lib/library-store";
import type { YouTubeScheduledPost } from "@/lib/types";

export const runtime = "nodejs";

type QueueBody = {
  accountId?: string;
  exportId?: string;
  caption?: string;
  defaultCaption?: string;
  orderedIds?: string[];
};

export async function GET(request: Request) {
  const accountId = new URL(request.url).searchParams.get("accountId")?.trim();
  const campaignId = await getActiveCampaignId();
  const youtube = await readYouTube(campaignId);
  const library = await readLibrary("exports", { campaignId });
  const exportById = new Map(library.exports.map((exp) => [exp.id, exp]));

  if (accountId) {
    const queue = getYouTubeAccountQueuePosts(youtube, accountId).map((post) => ({
      ...post,
      exportName:
        post.exportName || exportById.get(post.exportId)?.name || post.exportId,
      exportUrl: exportById.get(post.exportId)?.url ?? null,
    }));
    const available = getAvailableExportsForYouTubeAccount(
      youtube,
      library.exports,
      accountId,
    );
    return NextResponse.json({ accountId, queue, available });
  }

  const queues = Object.fromEntries(
    youtube.accounts.map((account) => [
      account.id,
      getYouTubeAccountQueuePosts(youtube, account.id).map((post) => ({
        ...post,
        exportName:
          post.exportName ||
          exportById.get(post.exportId)?.name ||
          post.exportId,
        exportUrl: exportById.get(post.exportId)?.url ?? null,
      })),
    ]),
  );

  return NextResponse.json({ queues });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as QueueBody;
    const accountId = body.accountId?.trim();
    const exportId = body.exportId?.trim();
    const caption = body.caption?.trim() ?? "";

    if (!accountId || !exportId) {
      return NextResponse.json(
        { error: "accountId and exportId are required." },
        { status: 400 },
      );
    }

    const campaignId = await getActiveCampaignId();
    const youtube = await readYouTube(campaignId);
    const account = youtube.accounts.find((item) => item.id === accountId);
    if (!account) {
      return NextResponse.json(
        { error: "YouTube account not found." },
        { status: 404 },
      );
    }

    if (isExportPublishedOnYouTubeAccount(youtube, accountId, exportId)) {
      return NextResponse.json(
        {
          error:
            "This video was already published on this channel. Pick a different finished video.",
        },
        { status: 409 },
      );
    }

    const reserved = getReservedExportIdsForYouTubeAccount(youtube, accountId);
    if (reserved.has(exportId)) {
      return NextResponse.json(
        {
          error:
            "This video is already in this channel's queue or scheduled. Pick a different finished video.",
        },
        { status: 409 },
      );
    }

    const library = await readLibrary("exports", { campaignId });
    const exp = library.exports.find((item) => item.id === exportId);
    if (!exp || exp.status !== "ready") {
      return NextResponse.json(
        { error: "Finished video not found." },
        { status: 404 },
      );
    }

    const text = resolveYouTubeScheduleText(
      exp,
      caption,
      body.defaultCaption?.trim(),
    );
    const post: YouTubeScheduledPost = {
      id: `yt-queue-${Date.now()}-${accountId}`,
      campaignId,
      accountId,
      exportId,
      exportName: exp.name,
      title: text.title,
      description: text.description,
      scheduledAt: new Date().toISOString(),
      status: "queued",
      source: "queue",
      queuePosition: nextYouTubeQueuePosition(youtube, accountId),
      createdAt: new Date().toISOString(),
    };

    await addYouTubeScheduledPost(post);
    return NextResponse.json(post);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not add video to queue.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as QueueBody;
    const accountId = body.accountId?.trim();
    const orderedIds = body.orderedIds;

    if (!accountId || !Array.isArray(orderedIds)) {
      return NextResponse.json(
        { error: "accountId and orderedIds are required." },
        { status: 400 },
      );
    }

    const campaignId = await getActiveCampaignId();
    if (!campaignId) {
      return NextResponse.json(
        { error: "Select a campaign first." },
        { status: 400 },
      );
    }

    await reorderYouTubeAccountQueue(accountId, orderedIds, campaignId);
    const youtube = await readYouTube(campaignId);
    return NextResponse.json({
      queue: getYouTubeAccountQueuePosts(youtube, accountId),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not reorder queue.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const updated = await updateYouTubeScheduledPost(id, {
    status: "cancelled",
    error: null,
  });
  if (!updated) {
    return NextResponse.json({ error: "Queue item not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id });
}
