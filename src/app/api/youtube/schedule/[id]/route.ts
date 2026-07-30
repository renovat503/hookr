import { NextResponse } from "next/server";
import { getActiveCampaignId } from "@/lib/active-campaign";
import { validateScheduleInstant } from "@/lib/calendar-utils";
import {
  readYouTube,
  removeYouTubeScheduledPost,
  updateYouTubeScheduledPost,
} from "@/lib/youtube-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

type PatchBody = {
  status?: string;
  scheduledAt?: string;
  title?: string;
  description?: string;
  caption?: string;
};

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  await removeYouTubeScheduledPost(id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json()) as PatchBody;
  const campaignId = await getActiveCampaignId();
  const youtube = await readYouTube(campaignId);
  const existing = youtube.scheduledPosts.find((post) => post.id === id);
  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (body.status === "cancelled") {
    const updated = await updateYouTubeScheduledPost(id, {
      status: "cancelled",
      error: null,
    });
    return NextResponse.json(updated);
  }

  const patch: Parameters<typeof updateYouTubeScheduledPost>[1] = {};

  if (body.title !== undefined) {
    patch.title = body.title.trim();
  }
  if (body.description !== undefined) {
    patch.description = body.description.trim();
  } else if (body.caption !== undefined) {
    patch.description = body.caption.trim();
  }

  if (body.scheduledAt !== undefined) {
    const scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json(
        { error: "Invalid scheduledAt datetime." },
        { status: 400 },
      );
    }
    if (existing.status !== "published") {
      const scheduleError = validateScheduleInstant(scheduledAt);
      if (scheduleError) {
        return NextResponse.json({ error: scheduleError }, { status: 400 });
      }
    }
    patch.scheduledAt = scheduledAt.toISOString();
  }

  if (existing.status === "queued" && body.scheduledAt) {
    patch.status = "scheduled";
    patch.source = "manual";
    patch.queuePosition = null;
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Unsupported patch." }, { status: 400 });
  }

  const updated = await updateYouTubeScheduledPost(id, patch);
  if (!updated) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json(updated);
}
