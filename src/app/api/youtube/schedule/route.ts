import { NextResponse } from "next/server";
import { getActiveCampaignId } from "@/lib/active-campaign";
import { validateScheduleInstant } from "@/lib/calendar-utils";
import {
  addYouTubeScheduledPost,
  isExportPublishedOnYouTubeAccount,
  readYouTube,
} from "@/lib/youtube-store";
import {
  getReservedExportIdsForYouTubeAccount,
  resolveYouTubeScheduleText,
} from "@/lib/youtube-queue";
import { readLibrary } from "@/lib/library-store";
import type { YouTubeScheduledPost } from "@/lib/types";

export const runtime = "nodejs";

type ScheduleBody = {
  accountId?: string;
  exportId?: string;
  title?: string;
  description?: string;
  caption?: string;
  scheduledAt?: string;
  publishNow?: boolean;
};

export async function GET() {
  const campaignId = await getActiveCampaignId();
  const data = await readYouTube(campaignId);
  return NextResponse.json({ scheduledPosts: data.scheduledPosts });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ScheduleBody;
    const accountId = body.accountId?.trim();
    const exportId = body.exportId?.trim();
    const publishNow = Boolean(body.publishNow);
    const caption = body.description?.trim() || body.caption?.trim() || "";

    if (!accountId || !exportId) {
      return NextResponse.json(
        { error: "accountId and exportId are required." },
        { status: 400 },
      );
    }

    const campaignId = await getActiveCampaignId();
    const youtube = await readYouTube(campaignId);
    const account = youtube.accounts.find((a) => a.id === accountId);
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
            "This video was already published on this channel and cannot be posted again.",
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
    const exp = library.exports.find((e) => e.id === exportId);
    if (!exp) {
      return NextResponse.json(
        { error: "Finished video not found." },
        { status: 404 },
      );
    }

    let scheduledAt = body.scheduledAt
      ? new Date(body.scheduledAt)
      : new Date();
    if (Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json(
        { error: "Invalid scheduledAt datetime." },
        { status: 400 },
      );
    }

    if (publishNow) {
      scheduledAt = new Date();
    } else {
      const scheduleError = validateScheduleInstant(scheduledAt);
      if (scheduleError) {
        return NextResponse.json({ error: scheduleError }, { status: 400 });
      }
    }

    const text = resolveYouTubeScheduleText(
      exp,
      caption || body.title,
      undefined,
    );
    const post: YouTubeScheduledPost = {
      id: `yt-sched-${Date.now()}`,
      campaignId,
      accountId,
      exportId,
      exportName: exp.name,
      title: body.title?.trim() || text.title,
      description: caption || text.description,
      scheduledAt: scheduledAt.toISOString(),
      status: "scheduled",
      source: "manual",
      createdAt: new Date().toISOString(),
    };

    await addYouTubeScheduledPost(post);
    return NextResponse.json(post);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not schedule post.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
