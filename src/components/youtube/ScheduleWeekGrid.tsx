"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDateIso, isToday } from "@/lib/calendar-utils";
import {
  addWeeks,
  buildScheduleSlot,
  findPostForSlot,
  formatSlotTimeLabel,
  getWeekDays,
  isSlotAvailable,
  isSlotPast,
  type ScheduleSlot,
} from "@/lib/posting-slots";
import type { YouTubeScheduledPost } from "@/lib/types";
import { cn } from "@/lib/utils";

export type WeekGridPost = YouTubeScheduledPost & {
  exportUrl?: string | null;
};

type ScheduleWeekGridProps = {
  weekAnchor: Date;
  slotTimes: string[];
  posts: WeekGridPost[];
  accountId: string;
  occupied: Set<string>;
  onWeekChange: (anchor: Date) => void;
  onSlotClick: (slot: ScheduleSlot, post: WeekGridPost | null) => void;
  disabled?: boolean;
};

export function ScheduleWeekGrid({
  weekAnchor,
  slotTimes,
  posts,
  accountId,
  occupied,
  onWeekChange,
  onSlotClick,
  disabled = false,
}: ScheduleWeekGridProps) {
  const weekDays = getWeekDays(weekAnchor);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface/70">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onWeekChange(addWeeks(weekAnchor, -1))}
            className="rounded-lg p-2 text-muted hover:bg-surface-hover hover:text-foreground"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onWeekChange(addWeeks(weekAnchor, 1))}
            className="rounded-lg p-2 text-muted hover:bg-surface-hover hover:text-foreground"
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onWeekChange(new Date())}
            className="ml-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
          >
            This week
          </button>
        </div>
        <p className="text-xs text-muted">
          Click an open slot to schedule a video
        </p>
      </div>

      <div
        className={cn(
          "grid grid-cols-7 divide-x divide-border",
          disabled && "pointer-events-none opacity-70",
        )}
      >
        {weekDays.map((day) => {
          const dateIso = formatDateIso(day);
          return (
            <div key={dateIso} className="min-w-0 p-2">
              <div className="mb-2 flex justify-center">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold sm:text-sm",
                    isToday(day)
                      ? "bg-accent text-accent-fg"
                      : "text-foreground",
                  )}
                >
                  {day.getDate()}
                </span>
              </div>
              <div className="space-y-2">
                {slotTimes.map((time) => {
                  const post = findPostForSlot(posts, accountId, dateIso, time);
                  const past = isSlotPast(dateIso, time);
                  const available = isSlotAvailable(dateIso, time, occupied);
                  const slot = buildScheduleSlot(day, dateIso, time);

                  if (post) {
                    return (
                      <button
                        key={time}
                        type="button"
                        onClick={() => onSlotClick(slot, post)}
                        className={cn(
                          "w-full rounded-xl border px-2 py-2 text-left transition-colors",
                          post.status === "published"
                            ? "border-border/60 bg-surface/50 opacity-60"
                            : post.status === "failed"
                              ? "border-danger/40 bg-danger/10"
                              : "border-accent/40 bg-accent/10 hover:bg-accent/15",
                        )}
                      >
                        <p className="truncate text-[11px] font-semibold leading-tight">
                          {post.exportName || post.exportId}
                        </p>
                        <p className="text-[10px] text-muted">
                          {formatSlotTimeLabel(time)}
                        </p>
                      </button>
                    );
                  }

                  return (
                    <button
                      key={time}
                      type="button"
                      disabled={past || !available}
                      onClick={() => onSlotClick(slot, null)}
                      className={cn(
                        "w-full rounded-xl border border-dashed px-2 py-3 text-center text-[11px] font-medium transition-colors",
                        past
                          ? "cursor-not-allowed border-border/40 text-muted/30"
                          : "border-border text-muted hover:border-accent hover:bg-accent/5 hover:text-foreground",
                      )}
                    >
                      {formatSlotTimeLabel(time)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
