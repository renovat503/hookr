import { NextResponse } from "next/server";
import {
  schedulePartsMatchAssignment,
  validateScheduleInstant,
} from "@/lib/calendar-utils";
import {
  addScheduledPosts,
  isExportPublishedOnAccount,
  readInstagram,
} from "@/lib/instagram-store";
import {
  getReservedExportIdsForAccount,
  resolveScheduleCaption,
} from "@/lib/instagram-queue";
import { readLibrary } from "@/lib/library-store";
import {
  getOccupiedSlotKeysInOffset,
  getPostingGoalForAccount,
  normalizeSlotTimes,
  slotKey,
} from "@/lib/posting-slots";
import type { ScheduledPost } from "@/lib/types";

export const runtime = "nodejs";

type BulkAssignment = {
  exportId?: string;
  dateIso?: string;
  time?: string;
  scheduledAt?: string;
  caption?: string;
};

type BulkBody = {
  accountId?: string;
  exportIds?: string[];
  assignments?: BulkAssignment[];
  defaultCaption?: string;
  timezoneOffsetMinutes?: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BulkBody;
    const accountId = body.accountId?.trim();
    const timezoneOffsetMinutes = body.timezoneOffsetMinutes ?? 0;
    const defaultCaption = body.defaultCaption?.trim() ?? "";

    const assignments =
      body.assignments
        ?.map((item) => ({
          exportId: item.exportId?.trim() ?? "",
          dateIso: item.dateIso?.trim() ?? "",
          time: item.time?.trim() ?? "",
          scheduledAt: item.scheduledAt?.trim() ?? "",
          caption: item.caption?.trim() ?? "",
        }))
        .filter(
          (item) =>
            item.exportId && item.dateIso && item.time && item.scheduledAt,
        ) ?? [];

    if (!accountId || !assignments.length) {
      return NextResponse.json(
        { error: "accountId and assignments are required." },
        { status: 400 },
      );
    }

    const instagram = await readInstagram();
    const goal = getPostingGoalForAccount(
      instagram.accountPostingGoals,
      accountId,
    );
    const allowedTimes = new Set(normalizeSlotTimes(goal.slotTimes));
    const account = instagram.accounts.find((item) => item.id === accountId);
    if (!account) {
      return NextResponse.json(
        { error: "Instagram account not found." },
        { status: 404 },
      );
    }

    const library = await readLibrary("exports");
    const exportById = new Map(library.exports.map((exp) => [exp.id, exp]));
    const reserved = getReservedExportIdsForAccount(instagram, accountId);
    const occupied = getOccupiedSlotKeysInOffset(
      instagram.scheduledPosts,
      accountId,
      goal.slotTimes,
      timezoneOffsetMinutes,
    );

    const scheduled: ScheduledPost[] = [];
    const skipped: Array<{ exportId: string; reason: string }> = [];

    for (const assignment of assignments) {
      const { exportId, dateIso, time, scheduledAt, caption } = assignment;

      if (!allowedTimes.has(time)) {
        skipped.push({ exportId, reason: "Time is not a posting goal slot." });
        continue;
      }

      const scheduleError = validateScheduleInstant(new Date(scheduledAt));
      if (scheduleError) {
        skipped.push({ exportId, reason: scheduleError });
        continue;
      }

      if (
        !schedulePartsMatchAssignment(
          scheduledAt,
          dateIso,
          time,
          timezoneOffsetMinutes,
        )
      ) {
        skipped.push({ exportId, reason: "Slot time does not match schedule." });
        continue;
      }

      const key = slotKey(dateIso, time);
      if (occupied.has(key)) {
        skipped.push({ exportId, reason: "Slot is already taken." });
        continue;
      }

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

      const post: ScheduledPost = {
        id: `sched-bulk-${Date.now()}-${scheduled.length}`,
        accountId,
        exportId,
        exportName: exp.name,
        caption: resolveScheduleCaption(exp, caption, defaultCaption),
        scheduledAt,
        status: "scheduled",
        source: "manual",
        createdAt: new Date().toISOString(),
      };

      scheduled.push(post);
      reserved.add(exportId);
      occupied.add(key);
    }

    if (!scheduled.length) {
      return NextResponse.json(
        { error: "No videos could be scheduled.", skipped },
        { status: 400 },
      );
    }

    await addScheduledPosts(scheduled);

    return NextResponse.json({ scheduled, skipped });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not bulk schedule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
