"use client";

import { useMemo, useRef, useState } from "react";
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
  formatDateIso,
  formatMonthYear,
  formatTimeShort,
  getMonthGrid,
  isToday,
  WEEKDAY_LABELS,
} from "@/lib/calendar-utils";
import type { ScheduledPost, ScheduledPostStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export type CalendarPost = ScheduledPost & {
  exportUrl?: string | null;
  displayAt: string;
};

const MAX_VISIBLE_POSTS = 3;

const STATUS_STYLES: Partial<Record<ScheduledPostStatus, string>> = {
  published: "opacity-60",
  failed: "border-danger/40 bg-danger/10",
  publishing: "border-warning/40 bg-warning/10",
};

function canDragPost(post: CalendarPost): boolean {
  return (
    post.status === "scheduled" ||
    post.status === "failed" ||
    post.status === "queued"
  );
}

type ScheduleCalendarProps = {
  posts: CalendarPost[];
  month: Date;
  onMonthChange: (month: Date) => void;
  onDayClick: (date: Date) => void;
  onPostClick: (post: CalendarPost) => void;
  onNewPost: (date?: Date) => void;
  onPostReschedule: (postId: string, targetDate: Date) => void | Promise<void>;
  onQueueDrop?: (queueItemId: string, targetDate: Date) => void | Promise<void>;
  rescheduling?: boolean;
};

export function ScheduleCalendar({
  posts,
  month,
  onMonthChange,
  onDayClick,
  onPostClick,
  onNewPost,
  onPostReschedule,
  onQueueDrop,
  rescheduling = false,
}: ScheduleCalendarProps) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [draggingPostId, setDraggingPostId] = useState<string | null>(null);
  const [dropTargetIso, setDropTargetIso] = useState<string | null>(null);
  const didDragRef = useRef(false);

  const postsByDay = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const post of posts) {
      const key = formatDateIso(new Date(post.displayAt));
      const list = map.get(key) ?? [];
      list.push(post);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.displayAt).getTime() - new Date(b.displayAt).getTime(),
      );
    }
    return map;
  }, [posts]);

  const days = useMemo(() => getMonthGrid(month), [month]);

  const goToday = () => onMonthChange(new Date());

  const clearDragState = () => {
    setDraggingPostId(null);
    setDropTargetIso(null);
  };

  const handleDrop = async (dayIso: string, dayDate: Date, e: React.DragEvent) => {
    e.preventDefault();
    clearDragState();

    const queueId = e.dataTransfer.getData(DRAG_QUEUE_MIME);
    const postId = e.dataTransfer.getData(DRAG_POST_MIME);

    if (queueId && onQueueDrop) {
      await onQueueDrop(queueId, dayDate);
      return;
    }
    if (postId) {
      const post = posts.find((item) => item.id === postId);
      if (!post || !canDragPost(post)) return;
      const sourceDay = formatDateIso(new Date(post.displayAt));
      if (sourceDay === dayIso) return;
      await onPostReschedule(postId, dayDate);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface/70">
      {/* Toolbar */}
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

      {/* Weekday headers */}
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

      {/* Day grid */}
      <div className={cn("grid grid-cols-7", rescheduling && "pointer-events-none opacity-70")}>
        {days.map((day) => {
          const dayPosts = postsByDay.get(day.iso) ?? [];
          const isExpanded = expandedDay === day.iso;
          const visiblePosts = isExpanded
            ? dayPosts
            : dayPosts.slice(0, MAX_VISIBLE_POSTS);
          const hiddenCount = dayPosts.length - visiblePosts.length;
          const isDropTarget = dropTargetIso === day.iso;

          return (
            <div
              key={day.iso}
              onDragOver={(e) => {
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
                "group relative min-h-[7.5rem] border-b border-r border-border p-1.5 transition-colors sm:min-h-[8.5rem] sm:p-2",
                !day.inMonth && "bg-surface/40",
                isDropTarget && "bg-accent/10 ring-2 ring-inset ring-accent/50",
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => onDayClick(day.date)}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium sm:text-sm",
                    isToday(day.date)
                      ? "bg-accent text-accent-fg"
                      : day.inMonth
                        ? "text-foreground hover:bg-surface-hover"
                        : "text-muted/50 hover:bg-surface-hover",
                  )}
                >
                  {day.date.getDate()}
                </button>
                <button
                  type="button"
                  onClick={() => onNewPost(day.date)}
                  className="rounded-md p-1 text-muted opacity-0 transition-opacity hover:bg-surface-hover hover:text-foreground group-hover:opacity-100"
                  aria-label={`Schedule post on ${day.iso}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="space-y-1">
                {visiblePosts.map((post) => {
                  const draggable = canDragPost(post);
                  const isDragging = draggingPostId === post.id;

                  return (
                    <div
                      key={post.id}
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
                        onPostClick(post);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onPostClick(post);
                        }
                      }}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-1.5 py-1 text-left transition-colors hover:bg-surface-hover",
                        STATUS_STYLES[post.status],
                        draggable && "cursor-grab active:cursor-grabbing",
                        isDragging && "opacity-40",
                      )}
                    >
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] text-[8px] font-bold text-white">
                        IG
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-tight sm:text-xs">
                        {formatTimeShort(post.displayAt)}
                      </span>
                      <Clapperboard className="h-3 w-3 shrink-0 text-muted" />
                    </div>
                  );
                })}
                {hiddenCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setExpandedDay(day.iso)}
                    className="w-full px-1 text-left text-[11px] text-muted hover:text-foreground"
                  >
                    {hiddenCount} more
                  </button>
                ) : null}
                {isExpanded && dayPosts.length > MAX_VISIBLE_POSTS ? (
                  <button
                    type="button"
                    onClick={() => setExpandedDay(null)}
                    className="w-full px-1 text-left text-[11px] text-muted hover:text-foreground"
                  >
                    Show less
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
