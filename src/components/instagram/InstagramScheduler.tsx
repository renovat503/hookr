"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Clapperboard,
  Layers,
  Link2,
  List,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { BulkScheduleModal } from "@/components/instagram/BulkScheduleModal";
import { PostingGoalPanel } from "@/components/instagram/PostingGoalPanel";
import {
  ScheduleCalendar,
} from "@/components/instagram/ScheduleCalendar";
import { SchedulePostModal } from "@/components/instagram/SchedulePostModal";
import { ScheduleWeekGrid } from "@/components/instagram/ScheduleWeekGrid";
import { ReelPlayer } from "@/components/ui/ReelPlayer";
import {
  defaultScheduleDateTime,
  DRAG_QUEUE_MIME,
  isPastDay,
  moveScheduledTimeToDate,
  startOfMonth,
  validateScheduleInstant,
} from "@/lib/calendar-utils";
import {
  getNextAvailableSlots,
  getOccupiedSlotKeys,
  getPostingGoalForAccount,
  type ScheduleSlot,
} from "@/lib/posting-slots";
import type { AccountPostingGoal, LibraryExport, ScheduledPost } from "@/lib/types";
import { cn } from "@/lib/utils";

type PublicAccount = {
  id: string;
  username: string;
  profilePictureUrl?: string | null;
};

type QueueItem = ScheduledPost & { exportUrl?: string | null };

type AccountQueue = {
  queue: QueueItem[];
  available: LibraryExport[];
};

type InstagramPayload = {
  configured: boolean;
  accounts: PublicAccount[];
  exports: LibraryExport[];
  scheduledPosts: (ScheduledPost & { exportUrl?: string | null })[];
  queues: Record<string, AccountQueue>;
  postingGoals?: Record<string, AccountPostingGoal>;
  autoPost?: {
    enabled: boolean;
    intervalHours?: 4 | 5 | 6;
    intervalOptions?: Array<4 | 5 | 6>;
  };
};

type ViewMode = "week" | "month" | "queue";

export function InstagramScheduler() {
  const [data, setData] = useState<InstagramPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeAccountId, setActiveAccountId] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [modalDate, setModalDate] = useState<Date | undefined>();
  const [modalTime, setModalTime] = useState<string | undefined>();
  const [editingPost, setEditingPost] = useState<
    (ScheduledPost & { exportUrl?: string | null }) | null
  >(null);
  const [rescheduling, setRescheduling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/instagram", {
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await res.json()) as InstagramPayload & { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not load Instagram.");
      setData(json);
      setActiveAccountId((current) => current || json.accounts[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected")) {
      setNotice("Instagram account connected.");
    }
    if (params.get("error")) {
      setError(params.get("error"));
    }
    if (params.get("connected") || params.get("error")) {
      window.history.replaceState({}, "", "/instagram");
    }
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        await fetch("/api/instagram/process-due", { method: "POST" });
        if (!cancelled) await load();
      } catch {
        // ignore
      }
    };
    void tick();
    const id = window.setInterval(tick, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [load]);

  const activeAccount = useMemo(
    () => data?.accounts.find((a) => a.id === activeAccountId) ?? null,
    [data, activeAccountId],
  );

  const activeQueue = activeAccountId
    ? data?.queues?.[activeAccountId]
    : null;

  const availableExports = activeQueue?.available ?? data?.exports ?? [];

  const unscheduledQueue = activeQueue?.queue ?? [];

  const activePostingGoal = useMemo(
    () =>
      getPostingGoalForAccount(data?.postingGoals, activeAccountId),
    [data?.postingGoals, activeAccountId],
  );

  const occupiedSlots = useMemo(() => {
    if (!data || !activeAccountId) return new Set<string>();
    return getOccupiedSlotKeys(
      data.scheduledPosts,
      activeAccountId,
      activePostingGoal.slotTimes,
    );
  }, [data, activeAccountId, activePostingGoal.slotTimes]);

  const bulkPreviewSlots = useMemo(() => {
    if (!availableExports.length) return [];
    return getNextAvailableSlots(
      activePostingGoal.slotTimes,
      occupiedSlots,
      Math.min(availableExports.length, 60),
    );
  }, [activePostingGoal.slotTimes, occupiedSlots, availableExports.length]);

  const openCreateModal = (date?: Date, time?: string) => {
    if (date && isPastDay(date)) {
      setError("Cannot schedule on a past date.");
      setNotice(null);
      return;
    }
    setModalMode("create");
    setEditingPost(null);
    setModalDate(date);
    setModalTime(time);
    setModalOpen(true);
  };

  const openEditModal = (post: ScheduledPost & { exportUrl?: string | null }) => {
    setModalMode("edit");
    setEditingPost(post);
    setModalDate(undefined);
    setModalTime(undefined);
    setModalOpen(true);
  };

  const openSlotModal = (slot: ScheduleSlot, post: ScheduledPost | null) => {
    if (post) {
      openEditModal(post);
      return;
    }
    openCreateModal(slot.date, slot.time);
  };

  const scheduleQueueItem = (item: QueueItem) => {
    setModalMode("edit");
    setEditingPost(item);
    setModalDate(new Date());
    setModalOpen(true);
  };

  const patchScheduledAt = async (postId: string, scheduledAt: string) => {
    const res = await fetch(
      `/api/instagram/schedule/${encodeURIComponent(postId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt }),
      },
    );
    const json = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(json.error || "Could not reschedule.");
  };

  const reschedulePost = async (postId: string, targetDate: Date) => {
    const post = data?.scheduledPosts.find((item) => item.id === postId);
    if (!post) return;

    if (isPastDay(targetDate)) {
      setError("Cannot schedule on a past date.");
      setNotice(null);
      return;
    }

    const nextAt = moveScheduledTimeToDate(post.scheduledAt, targetDate);
    const scheduleError = validateScheduleInstant(nextAt);
    if (scheduleError) {
      setError(scheduleError);
      setNotice(null);
      return;
    }

    setRescheduling(true);
    setError(null);
    setNotice(null);
    try {
      await patchScheduledAt(postId, nextAt.toISOString());
      setNotice("Post rescheduled.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reschedule.");
    } finally {
      setRescheduling(false);
    }
  };

  const scheduleQueueOnDate = async (queueItemId: string, targetDate: Date) => {
    if (isPastDay(targetDate)) {
      setError("Cannot schedule on a past date.");
      setNotice(null);
      return;
    }

    const scheduledAt = defaultScheduleDateTime(targetDate);
    if (!scheduledAt) {
      setError("Cannot schedule on a past date.");
      setNotice(null);
      return;
    }
    const scheduleError = validateScheduleInstant(scheduledAt);
    if (scheduleError) {
      setError(scheduleError);
      setNotice(null);
      return;
    }

    setRescheduling(true);
    setError(null);
    setNotice(null);
    try {
      await patchScheduledAt(queueItemId, scheduledAt.toISOString());
      setNotice("Post scheduled.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not schedule.");
    } finally {
      setRescheduling(false);
    }
  };

  const addToQueue = async (exportId: string) => {
    if (!activeAccountId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/instagram/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId, exportId }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not add to queue.");
      setNotice("Added to queue.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add to queue.");
    } finally {
      setBusy(false);
    }
  };

  const removeFromQueue = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/instagram/queue?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not remove.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove.");
    } finally {
      setBusy(false);
    }
  };

  const moveQueueItem = async (index: number, direction: -1 | 1) => {
    if (!activeAccountId || !activeQueue) return;
    const target = index + direction;
    if (target < 0 || target >= activeQueue.queue.length) return;
    const orderedIds = activeQueue.queue.map((item) => item.id);
    [orderedIds[index], orderedIds[target]] = [
      orderedIds[target],
      orderedIds[index],
    ];
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/instagram/queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId, orderedIds }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not reorder.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reorder.");
    } finally {
      setBusy(false);
    }
  };

  const savePostingGoal = async (goal: AccountPostingGoal) => {
    if (!activeAccountId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/instagram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: activeAccountId,
          postingGoal: goal,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not save posting goal.");
      setNotice("Posting goal saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save posting goal.");
    } finally {
      setBusy(false);
    }
  };

  const bulkSchedule = async (exportIds: string[]) => {
    if (!activeAccountId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/instagram/schedule/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId, exportIds }),
      });
      const json = (await res.json()) as {
        error?: string;
        scheduled?: ScheduledPost[];
        skipped?: Array<{ exportId: string; reason: string }>;
      };
      if (!res.ok) throw new Error(json.error || "Bulk schedule failed.");
      const count = json.scheduled?.length ?? 0;
      setNotice(
        count
          ? `Scheduled ${count} video${count === 1 ? "" : "s"}.`
          : "Bulk schedule completed.",
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk schedule failed.");
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const updateAutoPost = async (patch: {
    enabled?: boolean;
    intervalHours?: 4 | 5 | 6;
  }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/instagram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(patch.enabled !== undefined
            ? { autoPostEnabled: patch.enabled }
            : {}),
          ...(patch.intervalHours !== undefined
            ? { autoPostIntervalHours: patch.intervalHours }
            : {}),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not update.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (!data?.configured) {
    return (
      <div className="rounded-2xl border border-border bg-surface/70 p-6 text-center">
        <p className="text-sm text-muted">
          Add Instagram credentials to your environment, then connect an account.
        </p>
      </div>
    );
  }

  const autoPost = data.autoPost;

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-accent">
          {notice}
        </p>
      ) : null}

      {/* Top bar: accounts + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {data.accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => setActiveAccountId(account.id)}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                account.id === activeAccountId
                  ? "bg-accent text-accent-fg"
                  : "border border-border bg-surface-raised text-muted hover:text-foreground",
              )}
            >
              @{account.username}
              {(data.queues?.[account.id]?.queue.length ?? 0) > 0 && (
                <span className="ml-1.5 opacity-70">
                  ({data.queues[account.id].queue.length})
                </span>
              )}
            </button>
          ))}
          <a
            href="/api/instagram/auth"
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-4 py-2 text-sm text-muted hover:text-foreground"
          >
            <Link2 className="h-4 w-4" />
            Connect
          </a>
        </div>

        {data.accounts.length > 0 ? (
          <div className="inline-flex rounded-xl border border-border bg-surface-raised p-1">
            <button
              type="button"
              onClick={() => setViewMode("week")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium",
                viewMode === "week"
                  ? "bg-accent text-accent-fg"
                  : "text-muted hover:text-foreground",
              )}
            >
              <CalendarDays className="h-4 w-4" />
              Week
            </button>
            <button
              type="button"
              onClick={() => setViewMode("month")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium",
                viewMode === "month"
                  ? "bg-accent text-accent-fg"
                  : "text-muted hover:text-foreground",
              )}
            >
              <CalendarDays className="h-4 w-4" />
              Month
            </button>
            <button
              type="button"
              onClick={() => setViewMode("queue")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium",
                viewMode === "queue"
                  ? "bg-accent text-accent-fg"
                  : "text-muted hover:text-foreground",
              )}
            >
              <List className="h-4 w-4" />
              Queue
            </button>
          </div>
        ) : null}
      </div>

      {data.accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
          <p className="mb-4 text-sm text-muted">No Instagram accounts connected.</p>
          <a
            href="/api/instagram/auth"
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg"
          >
            <Link2 className="h-4 w-4" />
            Connect Instagram
          </a>
        </div>
      ) : viewMode === "week" || viewMode === "month" ? (
        <>
          {activeAccount ? (
            <PostingGoalPanel
              accountId={activeAccountId}
              username={activeAccount.username}
              goal={activePostingGoal}
              disabled={busy || rescheduling}
              onSave={savePostingGoal}
            />
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={busy || !availableExports.length || !bulkPreviewSlots.length}
              onClick={() => setBulkModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm font-medium hover:bg-surface-hover disabled:opacity-50"
            >
              <Layers className="h-4 w-4" />
              Bulk schedule
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => openCreateModal()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-accent-fg disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              New post
            </button>
          </div>

          {viewMode === "week" ? (
            <ScheduleWeekGrid
              weekAnchor={weekAnchor}
              slotTimes={activePostingGoal.slotTimes}
              posts={data.scheduledPosts}
              accountId={activeAccountId}
              occupied={occupiedSlots}
              onWeekChange={setWeekAnchor}
              onSlotClick={openSlotModal}
              disabled={rescheduling}
            />
          ) : (
            <ScheduleCalendar
              posts={data.scheduledPosts}
              slotTimes={activePostingGoal.slotTimes}
              accountId={activeAccountId}
              occupied={occupiedSlots}
              month={calendarMonth}
              onMonthChange={setCalendarMonth}
              onSlotClick={openSlotModal}
              onNewPost={openCreateModal}
              onPostReschedule={reschedulePost}
              onQueueDrop={scheduleQueueOnDate}
              rescheduling={rescheduling}
            />
          )}

          {unscheduledQueue.length > 0 ? (
            <section className="rounded-2xl border border-border bg-surface/70 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted">
                  No date — queue ({unscheduledQueue.length})
                </h3>
                <p className="text-xs text-muted">
                  Drag onto the calendar or click to pick a date
                </p>
              </div>
              <ul className="flex flex-wrap gap-2">
                {unscheduledQueue.map((item) => (
                  <li key={item.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      draggable={!busy && !rescheduling}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_QUEUE_MIME, item.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() => scheduleQueueItem(item)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          scheduleQueueItem(item);
                        }
                      }}
                      className={cn(
                        "inline-flex cursor-grab items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm hover:bg-surface-hover active:cursor-grabbing",
                        (busy || rescheduling) && "pointer-events-none opacity-50",
                      )}
                    >
                      <Clapperboard className="h-4 w-4 text-muted" />
                      <span className="max-w-[12rem] truncate">
                        {item.exportName || item.exportId}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-border bg-surface/70 p-4">
            <h3 className="mb-3 text-sm font-semibold text-muted">
              Finished videos
            </h3>
            {availableExports.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">
                {data.exports.length === 0
                  ? "No exports yet — create some in Produce."
                  : "All videos are queued or scheduled for this account."}
              </p>
            ) : (
              <ul className="max-h-[420px] space-y-2 overflow-y-auto">
                {availableExports.map((exp) => (
                  <li
                    key={exp.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised p-2"
                  >
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg">
                      <ReelPlayer
                        size="xs"
                        src={exp.url}
                        controls={false}
                        playsInline
                        preload="metadata"
                      />
                    </div>
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">
                      {exp.name}
                    </p>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openCreateModal()}
                        className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted hover:text-foreground disabled:opacity-50"
                      >
                        Schedule
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void addToQueue(exp.id)}
                        className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Queue
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-surface/70 p-4">
            <h3 className="mb-3 text-sm font-semibold text-muted">
              {activeAccount ? `@${activeAccount.username} queue` : "Queue"}
            </h3>
            {!activeQueue?.queue.length ? (
              <p className="py-8 text-center text-sm text-muted">
                Queue is empty. Add videos or schedule on the calendar.
              </p>
            ) : (
              <ul className="max-h-[420px] space-y-2 overflow-y-auto">
                {activeQueue.queue.map((item, index) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded-xl border border-border bg-surface-raised p-2"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => scheduleQueueItem(item)}
                      className="min-w-0 flex-1 truncate text-left text-sm hover:text-accent"
                    >
                      {item.exportName || item.exportId}
                    </button>
                    <button
                      type="button"
                      disabled={busy || index === 0}
                      onClick={() => void moveQueueItem(index, -1)}
                      className="rounded-lg p-1.5 text-muted hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={busy || index === activeQueue.queue.length - 1}
                      onClick={() => void moveQueueItem(index, 1)}
                      className="rounded-lg p-1.5 text-muted hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeFromQueue(item.id)}
                      className="rounded-lg p-1.5 text-muted hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {autoPost ? (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface/70 px-4 py-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoPost.enabled}
              disabled={busy}
              onChange={(e) =>
                void updateAutoPost({ enabled: e.target.checked })
              }
              className="accent-accent"
            />
            Auto-post
          </label>
          <span className="text-sm text-muted">every</span>
          <div className="flex gap-1">
            {(autoPost.intervalOptions ?? [4, 5, 6]).map((hours) => (
              <button
                key={hours}
                type="button"
                disabled={busy || !autoPost.enabled}
                onClick={() => void updateAutoPost({ intervalHours: hours })}
                className={cn(
                  "rounded-lg px-3 py-1 text-sm font-medium disabled:opacity-40",
                  autoPost.intervalHours === hours
                    ? "bg-accent text-accent-fg"
                    : "text-muted hover:text-foreground",
                )}
              >
                {hours}h
              </button>
            ))}
          </div>
          <span className="text-xs text-muted">
            Fallback when nothing is scheduled on the calendar.
          </span>
        </div>
      ) : null}

      <SchedulePostModal
        open={modalOpen}
        mode={modalMode}
        accounts={data.accounts}
        activeAccountId={activeAccountId}
        availableByAccount={Object.fromEntries(
          data.accounts.map((account) => [
            account.id,
            data.queues[account.id]?.available ?? [],
          ]),
        )}
        initialDate={modalDate}
        initialTime={modalTime}
        editingPost={editingPost}
        onClose={() => setModalOpen(false)}
        onSaved={async () => {
          setNotice(
            modalMode === "edit" ? "Schedule updated." : "Post scheduled.",
          );
          await load();
        }}
      />

      <BulkScheduleModal
        open={bulkModalOpen}
        accountUsername={activeAccount?.username ?? ""}
        exports={availableExports}
        previewSlots={bulkPreviewSlots}
        onClose={() => setBulkModalOpen(false)}
        onConfirm={bulkSchedule}
      />
    </div>
  );
}
