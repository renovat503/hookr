import { NextResponse } from "next/server";
import {
  addScheduledPost,
  isExportPublishedOnAccount,
  readInstagram,
} from "@/lib/instagram-store";
import {
  buildQueueCaption,
  getReservedExportIdsForAccount,
} from "@/lib/instagram-queue";
import { readLibrary } from "@/lib/library-store";
import {
  getNextAvailableSlots,
  getOccupiedSlotKeys,
  getPostingGoalForAccount,
} from "@/lib/posting-slots";
import type { ScheduledPost } from "@/lib/types";

export const runtime = "nodejs";

type BulkBody = {
  accountId?: string;
  exportIds?: string[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BulkBody;
    const accountId = body.accountId?.trim();
    const exportIds = (body.exportIds ?? [])
      .map((id) => id.trim())
      .filter(Boolean);

    if (!accountId || !exportIds.length) {
      return NextResponse.json(
        { error: "accountId and exportIds are required." },
        { status: 400 },
      );
    }

    const uniqueExportIds = [...new Set(exportIds)];
    const instagram = await readInstagram();
    const account = instagram.accounts.find((item) => item.id === accountId);
    if (!account) {
      return NextResponse.json(
        { error: "Instagram account not found." },
        { status: 404 },
      );
    }

    const library = await readLibrary();
    const exportById = new Map(library.exports.map((exp) => [exp.id, exp]));
    const reserved = getReservedExportIdsForAccount(instagram, accountId);
    const goal = getPostingGoalForAccount(
      instagram.accountPostingGoals,
      accountId,
    );
    const occupied = getOccupiedSlotKeys(
      instagram.scheduledPosts,
      accountId,
      goal.slotTimes,
    );
    const slots = getNextAvailableSlots(
      goal.slotTimes,
      occupied,
      uniqueExportIds.length,
    );

    if (slots.length < uniqueExportIds.length) {
      return NextResponse.json(
        {
          error: `Not enough open slots. Found ${slots.length} for ${uniqueExportIds.length} videos.`,
        },
        { status: 409 },
      );
    }

    const scheduled: ScheduledPost[] = [];
    const skipped: Array<{ exportId: string; reason: string }> = [];

    for (const [index, exportId] of uniqueExportIds.entries()) {
      const exp = exportById.get(exportId);
      if (!exp || exp.status !== "ready") {
        skipped.push({ exportId, reason: "Finished video not found." });
        continue;
      }
      if (isExportPublishedOnAccount(instagram, accountId, exportId)) {
        skipped.push({ exportId, reason: "Already published on this account." });
        continue;
      }
      if (reserved.has(exportId)) {
        skipped.push({ exportId, reason: "Already queued or scheduled." });
        continue;
      }

      const slot = slots[index];
      const post: ScheduledPost = {
        id: `sched-bulk-${Date.now()}-${index}`,
        accountId,
        exportId,
        exportName: exp.name,
        caption: buildQueueCaption(exp),
        scheduledAt: slot.scheduledAt.toISOString(),
        status: "scheduled",
        source: "manual",
        createdAt: new Date().toISOString(),
      };

      await addScheduledPost(post);
      reserved.add(exportId);
      scheduled.push(post);
    }

    if (!scheduled.length) {
      return NextResponse.json(
        { error: "No videos could be scheduled.", skipped },
        { status: 400 },
      );
    }

    return NextResponse.json({ scheduled, skipped });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not bulk schedule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
