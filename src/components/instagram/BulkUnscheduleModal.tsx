"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { formatDateIso, getSchedulePartsInOffset } from "@/lib/calendar-utils";
import {
  postsInDateRange,
  type SlotScheduledPost,
} from "@/lib/posting-slots";

type BulkUnscheduleModalProps = {
  open: boolean;
  accountId: string;
  accountUsername: string;
  posts: SlotScheduledPost[];
  onClose: () => void;
  onConfirm: (fromDateIso: string, toDateIso: string) => void | Promise<void>;
};

function addDaysIso(fromIso: string, days: number): string {
  const [y, m, d] = fromIso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return formatDateIso(date);
}

export function BulkUnscheduleModal({
  open,
  accountId,
  accountUsername,
  posts,
  onClose,
  onConfirm,
}: BulkUnscheduleModalProps) {
  const timezoneOffsetMinutes = useMemo(
    () => new Date().getTimezoneOffset(),
    [],
  );

  const [fromDateIso, setFromDateIso] = useState("");
  const [toDateIso, setToDateIso] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);

    const today = formatDateIso(new Date());
    const cancellable = posts.filter(
      (post) =>
        post.accountId === accountId &&
        (post.status === "scheduled" ||
          post.status === "queued" ||
          post.status === "failed"),
    );

    if (!cancellable.length) {
      setFromDateIso(today);
      setToDateIso(addDaysIso(today, 30));
      return;
    }

    const dates = cancellable
      .map(
        (post) =>
          getSchedulePartsInOffset(post.scheduledAt, timezoneOffsetMinutes)
            .dateIso,
      )
      .sort();

    setFromDateIso(dates[0] ?? today);
    setToDateIso(dates[dates.length - 1] ?? addDaysIso(today, 30));
  }, [open, accountId, posts, timezoneOffsetMinutes]);

  const matchCount = useMemo(() => {
    if (!fromDateIso || !toDateIso || fromDateIso > toDateIso) return 0;
    return postsInDateRange(
      posts,
      accountId,
      fromDateIso,
      toDateIso,
      timezoneOffsetMinutes,
    ).length;
  }, [
    posts,
    accountId,
    fromDateIso,
    toDateIso,
    timezoneOffsetMinutes,
  ]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (!fromDateIso || !toDateIso) return;
    if (fromDateIso > toDateIso) {
      setError("Start date must be on or before end date.");
      return;
    }
    if (!matchCount) {
      setError("No posts in that date range.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onConfirm(fromDateIso, toDateIso);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk unschedule failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Unschedule posts</h2>
            <p className="text-xs text-muted">
              @{accountUsername} · clears a date range from the calendar
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-hover disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {error ? (
            <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger whitespace-pre-wrap">
              {error}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="bulk-unschedule-from" className="text-sm font-medium">
                From
              </label>
              <input
                id="bulk-unschedule-from"
                type="date"
                value={fromDateIso}
                onChange={(e) => setFromDateIso(e.target.value)}
                disabled={busy}
                className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm outline-none ring-accent focus:ring-2 disabled:opacity-50"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="bulk-unschedule-to" className="text-sm font-medium">
                To
              </label>
              <input
                id="bulk-unschedule-to"
                type="date"
                value={toDateIso}
                onChange={(e) => setToDateIso(e.target.value)}
                disabled={busy}
                className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm outline-none ring-accent focus:ring-2 disabled:opacity-50"
              />
            </div>
          </div>

          <p className="text-sm text-muted">
            {matchCount === 0
              ? "No scheduled, queued, or failed posts in this range."
              : `${matchCount} post${matchCount === 1 ? "" : "s"} will be unscheduled.`}
          </p>
          <p className="text-xs text-muted">
            Videos stay in the library and can be scheduled again. Published posts
            are not affected.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy || matchCount === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm font-semibold text-danger hover:bg-danger/20 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Unschedule {matchCount > 0 ? matchCount : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
