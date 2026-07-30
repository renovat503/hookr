"use client";

import { useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Plus,
} from "lucide-react";
import {
  addMonths,
  DRAG_POST_MIME,
  DRAG_QUEUE_MIME,
  formatMonthYear,
  getSchedulePartsInOffset,
  getMonthGrid,
  isPastDay,
  isToday,
  WEEKDAY_LABELS,
} from "@/lib/calendar-utils";
import {
  findPostForSlot,
  buildScheduleSlot,
  formatSlotTimeLabel,
  isSlotAvailable,
  isSlotPast,
  type ScheduleSlot,
} from "@/lib/posting-slots";
import type { YouTubeScheduledPost, ScheduledPostStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export type CalendarPost = YouTubeScheduledPost & {
  exportUrl?: string | null;
  displayAt: string;
};

const STATUS_STYLES: Partial<Record<ScheduledPostStatus, string>> = {
  published: "opacity-60",
  failed: "border-danger/40 bg-danger/10",
  publishing: "border-warning/40 bg-warning/10",
};

function canDragPost(post: YouTubeScheduledPost): boolean {
  return (
    post.status === "scheduled" ||
    post.status === "failed" ||
    post.status === "queued"
  );
}

type ScheduleCalendarProps = {
  posts: YouTubeScheduledPost[];
  slotTimes: string[];
  accountId: string;
  occupied: Set<string>;
  month: Date;
  onMonthChange: (month: Date) => void;
  onSlotClick: (slot: ScheduleSlot, post: YouTubeScheduledPost | null) => void;
  onNewPost: (date?: Date) => void;
  onPostReschedule: (postId: string, targetDate: Date) => void | Promise<void>;
  onQueueDrop?: (queueItemId: string, targetDate: Date) => void | Promise<void>;
  rescheduling?: boolean;
};

export function ScheduleCalendar({
  posts,
  slotTimes,
  accountId,
  occupied,
  month,
  onMonthChange,
  onSlotClick,
  onNewPost,
  onPostReschedule,
  onQueueDrop,
  rescheduling = false,
}: ScheduleCalendarProps) {
  const [draggingPostId, setDraggingPostId] = useState<string | null>(null);
  const [dropTargetIso, setDropTargetIso] = useState<string | null>(null);
  const didDragRef = useRef(false);

  const days = getMonthGrid(month);

  const goToday = () => onMonthChange(new Date());

  const clearDragState = () => {
    setDraggingPostId(null);
    setDropTargetIso(null);
  };

  const handleDrop = async (dayIso: string, dayDate: Date, e: React.DragEvent) => {
    e.preventDefault();
    clearDragState();

    if (isPastDay(dayDate)) return;

    const queueId = e.dataTransfer.getData(DRAG_QUEUE_MIME);
    const postId = e.dataTransfer.getData(DRAG_POST_MIME);

    if (queueId && onQueueDrop) {
      await onQueueDrop(queueId, dayDate);
      return;
    }
    if (postId) {
      const post = posts.find((item) => item.id === postId);
      if (!post || !canDragPost(post)) return;
      const sourceDay = getSchedulePartsInOffset(
        post.scheduledAt,
        new Date().getTimezoneOffset(),
      ).dateIso;
      if (sourceDay === dayIso) return;
      await onPostReschedule(postId, dayDate);
    }
  };

  const cellMinHeight =
    slotTimes.length <= 3
      ? "min-h-[8.5rem]"
      : slotTimes.length <= 4
        ? "min-h-[10rem]"
        : "min-h-[12rem]";

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface/70">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMonthChange(addMonths(month, -1))}
            className="rounded-lg p-2 text-muted hover:bg-surface-hover hover:text-foreground"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(addMonths(month, 1))}
            className="rounded-lg p-2 text-muted hover:bg-surface-hover hover:text-foreground"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <h2 className="ml-2 text-sm font-semibold sm:text-base">
            {formatMonthYear(month)}
          </h2>
          <button
            type="button"
            onClick={goToday}
            className="ml-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
          >
            Today
          </button>
        </div>
        <button
          type="button"
          onClick={() => onNewPost()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm font-medium hover:bg-surface-hover"
        >
          <Plus className="h-4 w-4" />
          New post
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-border bg-surface-raised/50">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-2 py-2 text-center text-xs font-medium text-muted"
          >
            {label}
          </div>
        ))}
      </div>

      <div className={cn("grid grid-cols-7", rescheduling && "pointer-events-none opacity-70")}>
        {days.map((day) => {
          const isDropTarget = dropTargetIso === day.iso;
          const pastDay = isPastDay(day.date);

          const orphanPosts = posts.filter((post) => {
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
            if (parts.dateIso !== day.iso) return false;
            return !slotTimes.includes(parts.time);
          });

          return (
            <div
              key={day.iso}
              onDragOver={(e) => {
                if (pastDay) return;
                if (
                  !e.dataTransfer.types.includes(DRAG_POST_MIME) &&
                  !e.dataTransfer.types.includes(DRAG_QUEUE_MIME)
                ) {
                  return;
                }
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropTargetIso(day.iso);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDropTargetIso((current) =>
                  current === day.iso ? null : current,
                );
              }}
              onDrop={(e) => void handleDrop(day.iso, day.date, e)}
              className={cn(
                "group relative border-b border-r border-border p-1.5 sm:p-2",
                cellMinHeight,
                !day.inMonth && "bg-surface/40",
                pastDay && "bg-surface/30",
                isDropTarget && "bg-accent/10 ring-2 ring-inset ring-accent/50",
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium sm:text-sm",
                    isToday(day.date)
                      ? "bg-accent text-accent-fg"
                      : pastDay
                        ? "text-muted/40"
                        : day.inMonth
                          ? "text-foreground"
                          : "text-muted/50",
                  )}
                >
                  {day.date.getDate()}
                </span>
                {!pastDay ? (
                  <button
                    type="button"
                    onClick={() => onNewPost(day.date)}
                    className="rounded-md p-1 text-muted opacity-0 transition-opacity hover:bg-surface-hover hover:text-foreground group-hover:opacity-100"
                    aria-label={`Schedule post on ${day.iso}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>

              <div className="space-y-1">
                {slotTimes.map((time) => {
                  const post = findPostForSlot(posts, accountId, day.iso, time);
                  const slotPast = isSlotPast(day.iso, time);
                  const available = isSlotAvailable(day.iso, time, occupied);
                  const slot = buildScheduleSlot(day.date, day.iso, time);

                  if (post) {
                    const draggable = canDragPost(post);
                    const isDragging = draggingPostId === post.id;

                    return (
                      <div
                        key={time}
                        draggable={draggable}
                        onDragStart={(e) => {
                          if (!draggable) return;
                          didDragRef.current = false;
                          setDraggingPostId(post.id);
                          e.dataTransfer.setData(DRAG_POST_MIME, post.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDrag={() => {
                          didDragRef.current = true;
                        }}
                        onDragEnd={() => {
                          clearDragState();
                          window.setTimeout(() => {
                            didDragRef.current = false;
                          }, 0);
                        }}
                        onClick={() => {
                          if (didDragRef.current) return;
                          onSlotClick(slot, post);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSlotClick(slot, post);
                          }
                        }}
                        className={cn(
                          "flex w-full items-center gap-1 rounded-lg border px-1.5 py-1 text-left transition-colors",
                          post.status === "failed"
                            ? "border-danger/40 bg-danger/10"
                            : "border-accent/40 bg-accent/10 hover:bg-accent/15",
                          STATUS_STYLES[post.status],
                          draggable && "cursor-grab active:cursor-grabbing",
                          isDragging && "opacity-40",
                        )}
                      >
                        <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] text-[7px] font-bold text-white">
                          IG
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[10px] font-medium leading-tight sm:text-[11px]">
                          {formatSlotTimeLabel(time)}
                        </span>
                        <Clapperboard className="h-2.5 w-2.5 shrink-0 text-muted" />
                      </div>
                    );
                  }

                  return (
                    <button
                      key={time}
                      type="button"
                      disabled={slotPast || !available}
                      onClick={() => onSlotClick(slot, null)}
                      className={cn(
                        "w-full rounded-lg border border-dashed px-1.5 py-1.5 text-center text-[10px] font-medium transition-colors sm:text-[11px]",
                        slotPast
                          ? "cursor-not-allowed border-border/40 text-muted/30"
                          : "border-border text-muted hover:border-accent hover:bg-accent/5 hover:text-foreground",
                      )}
                    >
                      {formatSlotTimeLabel(time)}
                    </button>
                  );
                })}

                {orphanPosts.map((post) => {
                  const draggable = canDragPost(post);
                  const timezoneOffsetMinutes = new Date().getTimezoneOffset();
                  const parts = getSchedulePartsInOffset(
                    post.scheduledAt,
                    timezoneOffsetMinutes,
                  );
                  const slot: ScheduleSlot = {
                    date: day.date,
                    dateIso: day.iso,
                    time: parts.time,
                    scheduledAt: new Date(post.scheduledAt),
                    timezoneOffsetMinutes,
                    key: `${post.id}-orphan`,
                  };

                  return (
                    <div
                      key={post.id}
                      draggable={draggable}
                      onClick={() => onSlotClick(slot, post)}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "flex w-full items-center gap-1 rounded-lg border border-border bg-surface-raised px-1.5 py-1 text-left text-[10px]",
                        draggable && "cursor-grab",
                      )}
                    >
                      <span className="truncate font-medium">
                        {formatSlotTimeLabel(parts.time)}
                      </span>
                    </div>
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
