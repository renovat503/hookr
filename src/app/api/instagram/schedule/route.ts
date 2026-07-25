import { NextResponse } from "next/server";
import {
  addScheduledPost,
  isExportPublished,
  readInstagram,
} from "@/lib/instagram-store";
import { readLibrary } from "@/lib/library-store";
import type { ScheduledPost } from "@/lib/types";

export const runtime = "nodejs";

type ScheduleBody = {
  accountId?: string;
  exportId?: string;
  caption?: string;
  scheduledAt?: string;
  publishNow?: boolean;
};

export async function GET() {
  const data = await readInstagram();
  return NextResponse.json({ scheduledPosts: data.scheduledPosts });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ScheduleBody;
    const accountId = body.accountId?.trim();
    const exportId = body.exportId?.trim();
    const caption = body.caption?.trim() ?? "";
    const publishNow = Boolean(body.publishNow);

    if (!accountId || !exportId) {
      return NextResponse.json(
        { error: "accountId and exportId are required." },
        { status: 400 },
      );
    }

    const instagram = await readInstagram();
    const account = instagram.accounts.find((a) => a.id === accountId);
    if (!account) {
      return NextResponse.json(
        { error: "Instagram account not found." },
        { status: 404 },
      );
    }

    if (isExportPublished(instagram, exportId)) {
      return NextResponse.json(
        { error: "This video was already published and cannot be posted again." },
        { status: 409 },
      );
    }

    const pending = instagram.scheduledPosts.find(
      (p) =>
        p.exportId === exportId &&
        (p.status === "scheduled" || p.status === "publishing"),
    );
    if (pending) {
      return NextResponse.json(
        {
          error:
            "This video is already scheduled or publishing. Pick a different finished video.",
        },
        { status: 409 },
      );
    }

    const library = await readLibrary();
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
    } else if (scheduledAt.getTime() < Date.now() - 60_000) {
      return NextResponse.json(
        { error: "Schedule time must be in the future." },
        { status: 400 },
      );
    }

    const post: ScheduledPost = {
      id: `sched-${Date.now()}`,
      accountId,
      exportId,
      exportName: exp.name,
      caption:
        caption ||
        [exp.overlayText, exp.name].filter(Boolean).join("\n\n") ||
        exp.name,
      scheduledAt: scheduledAt.toISOString(),
      status: "scheduled",
      createdAt: new Date().toISOString(),
    };

    await addScheduledPost(post);
    return NextResponse.json(post);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not schedule post.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
