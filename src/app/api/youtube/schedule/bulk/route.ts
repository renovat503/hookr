import { NextResponse } from "next/server";
import { getActiveCampaignId } from "@/lib/active-campaign";
import {
  getSchedulePartsInOffset,
  validateScheduleInstant,
} from "@/lib/calendar-utils";
import {
  addYouTubeScheduledPosts,
  isExportPublishedOnYouTubeAccount,
  readYouTube,
} from "@/lib/youtube-store";
import {
  getReservedExportIdsForYouTubeAccount,
  resolveYouTubeScheduleText,
} from "@/lib/youtube-queue";
import { readLibrary } from "@/lib/library-store";
import {
  getOccupiedSlotKeysInOffset,
  getPostingGoalForAccount,
  normalizeSlotTimes,
  slotKey,
} from "@/lib/posting-slots";
import { formatBulkScheduleFailure } from "@/lib/bulk-schedule-errors";
import type { YouTubeScheduledPost } from "@/lib/types";

export const runtime = "nodejs";

type BulkAssignment = {
  exportId?: string;
  dateIso?: string;
  time?: string;
  scheduledAt?: string;
  caption?: string;
  description?: string;
  timezoneOffsetMinutes?: number;
};

type BulkBody = {
  accountId?: string;
  assignments?: BulkAssignment[];
  defaultCaption?: string;
  timezoneOffsetMinutes?: number;
};

function resolveTimezoneOffsetMinutes(
  assignment: BulkAssignment,
  fallback?: number,
): number {
  if (typeof assignment.timezoneOffsetMinutes === "number") {
    return assignment.timezoneOffsetMinutes;
  }
  if (typeof fallback === "number") {
    return fallback;
  }
  return 0;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BulkBody;
    const accountId = body.accountId?.trim();
    const requestTimezoneOffsetMinutes =
      typeof body.timezoneOffsetMinutes === "number"
        ? body.timezoneOffsetMinutes
        : undefined;
    const defaultCaption = body.defaultCaption?.trim() ?? "";

    const assignments =
      body.assignments
        ?.map((item) => ({
          exportId: item.exportId?.trim() ?? "",
          dateIso: item.dateIso?.trim() ?? "",
          time: item.time?.trim() ?? "",
          scheduledAt: item.scheduledAt?.trim() ?? "",
          caption: item.caption?.trim() ?? "",
          description: item.description?.trim() ?? "",
          timezoneOffsetMinutes: item.timezoneOffsetMinutes,
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

    const campaignId = await getActiveCampaignId();
    const youtube = await readYouTube(campaignId);
    const goal = getPostingGoalForAccount(
      youtube.accountPostingGoals,
      accountId,
    );
    const allowedTimes = new Set(normalizeSlotTimes(goal.slotTimes));
    const account = youtube.accounts.find((item) => item.id === accountId);
    if (!account) {
      return NextResponse.json(
        { error: "YouTube account not found." },
        { status: 404 },
      );
    }

    const library = await readLibrary("exports", { campaignId });
    const exportById = new Map(library.exports.map((exp) => [exp.id, exp]));
    const reserved = getReservedExportIdsForYouTubeAccount(youtube, accountId);
    const occupied = getOccupiedSlotKeysInOffset(
      youtube.scheduledPosts,
      accountId,
      goal.slotTimes,
      requestTimezoneOffsetMinutes ?? 0,
    );

    const scheduled: YouTubeScheduledPost[] = [];
    const skipped: Array<{ exportId: string; reason: string }> = [];

    for (const assignment of assignments) {
      const { exportId, scheduledAt, caption, description } = assignment;
      const timezoneOffsetMinutes = resolveTimezoneOffsetMinutes(
        assignment,
        requestTimezoneOffsetMinutes,
      );
      const slotParts = getSchedulePartsInOffset(
        scheduledAt,
        timezoneOffsetMinutes,
      );

      if (!allowedTimes.has(slotParts.time)) {
        skipped.push({ exportId, reason: "Time is not a posting goal slot." });
        continue;
      }

      const scheduleError = validateScheduleInstant(new Date(scheduledAt));
      if (scheduleError) {
        skipped.push({ exportId, reason: scheduleError });
        continue;
      }

      const key = slotKey(slotParts.dateIso, slotParts.time);
      if (occupied.has(key)) {
        skipped.push({ exportId, reason: "Slot is already taken." });
        continue;
      }

      const exp = exportById.get(exportId);
      if (!exp || exp.status !== "ready") {
        skipped.push({ exportId, reason: "Finished video not found." });
        continue;
      }
      if (isExportPublishedOnYouTubeAccount(youtube, accountId, exportId)) {
        skipped.push({ exportId, reason: "Already published on this channel." });
        continue;
      }
      if (reserved.has(exportId)) {
        skipped.push({ exportId, reason: "Already queued or scheduled." });
        continue;
      }

      const text = resolveYouTubeScheduleText(
        exp,
        description || caption,
        defaultCaption,
      );
      const post: YouTubeScheduledPost = {
        id: `yt-bulk-${Date.now()}-${scheduled.length}`,
        campaignId,
        accountId,
        exportId,
        exportName: exp.name,
        title: text.title,
        description: text.description,
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
        {
          error: formatBulkScheduleFailure(skipped),
          skipped,
        },
        { status: 400 },
      );
    }

    await addYouTubeScheduledPosts(scheduled);

    return NextResponse.json({ scheduled, skipped });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not bulk schedule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
