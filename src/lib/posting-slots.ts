import {
  combineDateAndTime,
  formatDateIso,
  formatTimeInputValue,
  getSchedulePartsInOffset,
  instantFromLocalParts,
  isPastDay,
  startOfDay,
  validateScheduleInstant,
} from "@/lib/calendar-utils";
import type { AccountPostingGoal, ScheduledPost } from "@/lib/types";

export type SlotScheduledPost = Pick<
  ScheduledPost,
  "id" | "accountId" | "scheduledAt" | "status"
>;

export const DEFAULT_POSTING_GOAL: AccountPostingGoal = {
  postsPerDay: 3,
  slotTimes: ["06:00", "09:00", "12:00"],
};

export const POSTING_GOAL_PRESETS: Record<number, string[]> = {
  1: ["12:00"],
  2: ["09:00", "17:00"],
  3: ["06:00", "09:00", "12:00"],
  4: ["06:00", "09:00", "12:00", "17:00"],
  5: ["06:00", "09:00", "12:00", "15:00", "18:00"],
  6: ["06:00", "08:00", "10:00", "12:00", "15:00", "18:00"],
};

export type ScheduleSlot = {
  date: Date;
  dateIso: string;
  time: string;
  scheduledAt: Date;
  timezoneOffsetMinutes: number;
  key: string;
};

export function normalizeSlotTimes(times: string[]): string[] {
  const normalized = times
    .map((time) => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
      if (!match) return null;
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    })
    .filter((time): time is string => Boolean(time));
  return [...new Set(normalized)].sort();
}

export function normalizePostingGoal(
  goal: Partial<AccountPostingGoal> | undefined,
): AccountPostingGoal {
  const postsPerDay = Math.min(
    6,
    Math.max(1, Math.floor(goal?.postsPerDay ?? DEFAULT_POSTING_GOAL.postsPerDay)),
  );
  const preset = POSTING_GOAL_PRESETS[postsPerDay];
  const slotTimes = normalizeSlotTimes(
    goal?.slotTimes?.length ? goal.slotTimes : preset,
  );
  return {
    postsPerDay,
    slotTimes: slotTimes.length ? slotTimes : preset,
  };
}

export function getPostingGoalForAccount(
  goals: Record<string, AccountPostingGoal> | undefined,
  accountId: string,
): AccountPostingGoal {
  return normalizePostingGoal(goals?.[accountId]);
}

export function slotKey(dateIso: string, time: string): string {
  return `${dateIso}@${time}`;
}

export function buildScheduleSlot(
  date: Date,
  dateIso: string,
  time: string,
): ScheduleSlot {
  const timezoneOffsetMinutes = new Date().getTimezoneOffset();
  return {
    date,
    dateIso,
    time,
    scheduledAt: instantFromLocalParts(dateIso, time, timezoneOffsetMinutes),
    timezoneOffsetMinutes,
    key: slotKey(dateIso, time),
  };
}

export function formatSlotTimeLabel(time: string): string {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  const date = new Date();
  date.setHours(hours, minutes ?? 0, 0, 0);
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function getWeekDays(anchor: Date): Date[] {
  const start = new Date(anchor);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function addWeeks(date: Date, weeks: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + weeks * 7);
  return next;
}

const OCCUPIED_STATUSES = new Set(["scheduled", "publishing"]);

export function getOccupiedSlotKeys(
  posts: SlotScheduledPost[],
  accountId: string,
  slotTimes: string[],
): Set<string> {
  return getOccupiedSlotKeysInOffset(
    posts,
    accountId,
    slotTimes,
    new Date().getTimezoneOffset(),
  );
}

export function getOccupiedSlotKeysInOffset(
  posts: SlotScheduledPost[],
  accountId: string,
  slotTimes: string[],
  timezoneOffsetMinutes: number,
): Set<string> {
  const allowed = new Set(normalizeSlotTimes(slotTimes));
  const occupied = new Set<string>();
  for (const post of posts) {
    if (post.accountId !== accountId || !OCCUPIED_STATUSES.has(post.status)) {
      continue;
    }
    const parts = getSchedulePartsInOffset(
      post.scheduledAt,
      timezoneOffsetMinutes,
    );
    if (allowed.has(parts.time)) {
      occupied.add(slotKey(parts.dateIso, parts.time));
    }
  }
  return occupied;
}

export function findPostForSlot<T extends SlotScheduledPost>(
  posts: T[],
  accountId: string,
  dateIso: string,
  time: string,
): T | null {
  return (
    posts.find((post) => {
      if (post.accountId !== accountId) return false;
      if (
        post.status !== "scheduled" &&
        post.status !== "publishing" &&
        post.status !== "published" &&
        post.status !== "failed"
      ) {
        return false;
      }
      const parts = getSchedulePartsInOffset(
        post.scheduledAt,
        new Date().getTimezoneOffset(),
      );
      return parts.dateIso === dateIso && parts.time === time;
    }) ?? null
  );
}

export function isSlotAvailable(
  dateIso: string,
  time: string,
  occupied: Set<string>,
): boolean {
  if (occupied.has(slotKey(dateIso, time))) return false;
  const scheduledAt = combineDateAndTime(dateIso, time);
  return !validateScheduleInstant(scheduledAt);
}

export function isSlotPast(dateIso: string, time: string): boolean {
  const scheduledAt = combineDateAndTime(dateIso, time);
  return (
    isPastDay(scheduledAt) ||
    Boolean(validateScheduleInstant(scheduledAt))
  );
}

export function getNextAvailableSlots(
  slotTimes: string[],
  occupied: Set<string>,
  count: number,
  fromDate = new Date(),
  maxDays = 120,
): ScheduleSlot[] {
  if (!count || !slotTimes.length) return [];

  const sortedTimes = normalizeSlotTimes(slotTimes);
  const reserved = new Set(occupied);
  const slots: ScheduleSlot[] = [];
  const start = startOfDay(fromDate);
  const timezoneOffsetMinutes = new Date().getTimezoneOffset();

  for (let dayOffset = 0; dayOffset < maxDays && slots.length < count; dayOffset++) {
    const date = new Date(start);
    date.setDate(start.getDate() + dayOffset);
    const dateIso = formatDateIso(date);

    for (const time of sortedTimes) {
      const key = slotKey(dateIso, time);
      if (reserved.has(key)) continue;
      const scheduledAt = instantFromLocalParts(
        dateIso,
        time,
        timezoneOffsetMinutes,
      );
      if (validateScheduleInstant(scheduledAt)) continue;
      slots.push({
        date,
        dateIso,
        time,
        scheduledAt,
        timezoneOffsetMinutes,
        key,
      });
      reserved.add(key);
      if (slots.length >= count) break;
    }
  }

  return slots;
}

export function previewBulkSchedule(
  slotTimes: string[],
  occupied: Set<string>,
  exportCount: number,
): ScheduleSlot[] {
  return getNextAvailableSlots(slotTimes, occupied, exportCount);
}
