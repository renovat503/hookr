import { NextResponse } from "next/server";
import {
  addScheduledPost,
  isExportPublishedOnAccount,
  readInstagram,
  reorderAccountQueue,
  updateScheduledPost,
} from "@/lib/instagram-store";
import {
  getAccountQueuePosts,
  getAvailableExportsForAccount,
  getReservedExportIdsForAccount,
  nextQueuePosition,
  resolveScheduleCaption,
} from "@/lib/instagram-queue";
import { readLibrary } from "@/lib/library-store";
import type { ScheduledPost } from "@/lib/types";

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
  const instagram = await readInstagram();
  const library = await readLibrary("exports");
  const exportById = new Map(library.exports.map((exp) => [exp.id, exp]));

  if (accountId) {
    const queue = getAccountQueuePosts(instagram, accountId).map((post) => ({
      ...post,
      exportName:
        post.exportName || exportById.get(post.exportId)?.name || post.exportId,
      exportUrl: exportById.get(post.exportId)?.url ?? null,
    }));
    const available = getAvailableExportsForAccount(
      instagram,
      library.exports,
      accountId,
    );
    return NextResponse.json({ accountId, queue, available });
  }

  const queues = Object.fromEntries(
    instagram.accounts.map((account) => [
      account.id,
      getAccountQueuePosts(instagram, account.id).map((post) => ({
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

    const instagram = await readInstagram();
    const account = instagram.accounts.find((item) => item.id === accountId);
    if (!account) {
      return NextResponse.json(
        { error: "Instagram account not found." },
        { status: 404 },
      );
    }

    if (isExportPublishedOnAccount(instagram, accountId, exportId)) {
      return NextResponse.json(
        {
          error:
            "This video was already published on this account. Pick a different finished video.",
        },
        { status: 409 },
      );
    }

    const reserved = getReservedExportIdsForAccount(instagram, accountId);
    if (reserved.has(exportId)) {
      return NextResponse.json(
        {
          error:
            "This video is already in this account's queue or scheduled. Pick a different finished video.",
        },
        { status: 409 },
      );
    }

    const library = await readLibrary("exports");
    const exp = library.exports.find((item) => item.id === exportId);
    if (!exp || exp.status !== "ready") {
      return NextResponse.json(
        { error: "Finished video not found." },
        { status: 404 },
      );
    }

    const post: ScheduledPost = {
      id: `queue-${Date.now()}-${accountId}`,
      accountId,
      exportId,
      exportName: exp.name,
      caption: resolveScheduleCaption(
        exp,
        caption,
        body.defaultCaption?.trim(),
      ),
      scheduledAt: new Date().toISOString(),
      status: "queued",
      source: "queue",
      queuePosition: nextQueuePosition(instagram, accountId),
      createdAt: new Date().toISOString(),
    };

    await addScheduledPost(post);
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

    await reorderAccountQueue(accountId, orderedIds);
    const instagram = await readInstagram();
    return NextResponse.json({
      queue: getAccountQueuePosts(instagram, accountId),
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

  const updated = await updateScheduledPost(id, {
    status: "cancelled",
    error: null,
  });
  if (!updated) {
    return NextResponse.json({ error: "Queue item not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id });
}
