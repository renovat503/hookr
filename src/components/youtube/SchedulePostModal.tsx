"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { ReelPlayer } from "@/components/ui/ReelPlayer";
import {
  combineDateAndTime,
  defaultScheduleTime,
  formatDateIso,
  formatTimeInputValue,
  isPastDay,
  minScheduleDateIso,
  validateScheduleDateTime,
} from "@/lib/calendar-utils";
import type { LibraryExport, YouTubeScheduledPost } from "@/lib/types";
import { cn } from "@/lib/utils";

type PublicAccount = {
  id: string;
  channelTitle: string;
};

type SchedulePostModalProps = {
  open: boolean;
  mode: "create" | "edit";
  accounts: PublicAccount[];
  activeAccountId: string;
  availableByAccount: Record<string, LibraryExport[]>;
  initialDate?: Date;
  initialTime?: string;
  editingPost?: (YouTubeScheduledPost & { exportUrl?: string | null }) | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

export function SchedulePostModal({
  open,
  mode,
  accounts,
  activeAccountId,
  availableByAccount,
  initialDate,
  initialTime,
  editingPost,
  onClose,
  onSaved,
}: SchedulePostModalProps) {
  const [accountId, setAccountId] = useState(activeAccountId);
  const [exportId, setExportId] = useState("");
  const [dateIso, setDateIso] = useState(formatDateIso(new Date()));
  const [time, setTime] = useState(defaultScheduleTime());
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exports = availableByAccount[accountId] ?? [];

  useEffect(() => {
    if (!open) return;
    const nextAccountId = editingPost?.accountId ?? activeAccountId;
    const nextExports = availableByAccount[nextAccountId] ?? [];
    setAccountId(nextAccountId);
    setExportId(editingPost?.exportId ?? nextExports[0]?.id ?? "");
    setDateIso(
      formatDateIso(
        (() => {
          const picked =
            initialDate ??
            (editingPost
              ? new Date(editingPost.scheduledAt)
              : new Date());
          return isPastDay(picked) ? new Date() : picked;
        })(),
      ),
    );
    setTime(
      editingPost
        ? formatTimeInputValue(editingPost.scheduledAt)
        : initialTime ?? defaultScheduleTime(),
    );
    setTitle(editingPost?.title ?? "");
    setDescription(editingPost?.description ?? "");
    setError(null);
  }, [open, activeAccountId, editingPost, availableByAccount, initialDate, initialTime]);

  useEffect(() => {
    if (!open || mode !== "create") return;
    if (exports.some((exp) => exp.id === exportId)) return;
    setExportId(exports[0]?.id ?? "");
  }, [accountId, exports, exportId, mode, open]);

  const selectedExport = useMemo(
    () => exports.find((exp) => exp.id === exportId) ?? null,
    [exports, exportId],
  );

  if (!open) return null;

  const canEditSchedule =
    !editingPost ||
    editingPost.status === "scheduled" ||
    editingPost.status === "queued" ||
    editingPost.status === "failed";

  const save = async () => {
    if (!accountId || !exportId) {
      setError("Pick an account and video.");
      return;
    }
    const scheduleError = validateScheduleDateTime(dateIso, time);
    if (scheduleError) {
      setError(scheduleError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const scheduledAt = combineDateAndTime(dateIso, time).toISOString();

      if (mode === "edit" && editingPost) {
        const res = await fetch(
          `/api/youtube/schedule/${encodeURIComponent(editingPost.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scheduledAt, title, description }),
          },
        );
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error || "Could not update post.");
      } else {
        const res = await fetch("/api/youtube/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId,
            exportId,
            title,
            description,
            scheduledAt,
          }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error || "Could not schedule post.");
      }

      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const cancelPost = async () => {
    if (!editingPost) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/youtube/schedule/${encodeURIComponent(editingPost.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "cancelled" }),
        },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not cancel post.");
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed.");
    } finally {
      setBusy(false);
    }
  };

  const retryUpload = async () => {
    if (!editingPost) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/youtube/schedule/${encodeURIComponent(editingPost.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retry: true }),
        },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not retry upload.");
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-modal-title"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="schedule-modal-title" className="text-sm font-semibold">
            {mode === "edit" ? "Edit scheduled post" : "Schedule post"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70dvh] space-y-4 overflow-y-auto p-4">
          {error ? (
            <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}

          {editingPost?.status === "failed" && editingPost.error ? (
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              <p className="font-medium">Upload failed</p>
              <p className="mt-1 whitespace-pre-wrap">{editingPost.error}</p>
              <p className="mt-2 text-xs text-danger/80">
                Quota failures retry automatically after the daily reset. You can
                also retry manually once uploads are available again.
              </p>
            </div>
          ) : null}

          {editingPost?.status === "scheduled" && editingPost.youtubeVideoId ? (
            <p className="rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-foreground">
              This video is already on YouTube and will go public at the scheduled
              time.
            </p>
          ) : null}

          {editingPost?.status === "scheduled" && !editingPost.youtubeVideoId ? (
            <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
              Scheduled locally. Hookr uploads to YouTube within 24 hours of this
              publish time (about six uploads per day).
            </p>
          ) : null}

          {mode === "create" ? (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted">Account</span>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm"
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.channelTitle}
                  </option>
                ))}
              </select>
            </label>
          ) : editingPost ? (
            <p className="text-sm text-muted">
              {accounts.find((a) => a.id === editingPost.accountId)?.channelTitle}
              {" · "}
              {editingPost.exportName || editingPost.exportId}
            </p>
          ) : null}

          {mode === "create" ? (
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted">Video</span>
              {exports.length === 0 ? (
                <p className="text-sm text-muted">
                  No finished videos available for this account.
                </p>
              ) : (
                <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                  {exports.map((exp) => (
                    <li key={exp.id}>
                      <button
                        type="button"
                        onClick={() => setExportId(exp.id)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors",
                          exportId === exp.id
                            ? "border-accent bg-accent/10"
                            : "border-border bg-surface-raised hover:bg-surface-hover",
                        )}
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
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {exp.name}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : selectedExport?.url || editingPost?.exportUrl ? (
            <div className="h-40 w-24 overflow-hidden rounded-xl">
              <ReelPlayer
                size="sm"
                src={selectedExport?.url ?? editingPost?.exportUrl ?? ""}
                controls
                playsInline
                preload="metadata"
              />
            </div>
          ) : null}

          {canEditSchedule ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted">Date</span>
                <input
                  type="date"
                  value={dateIso}
                  min={minScheduleDateIso()}
                  onChange={(e) => setDateIso(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted">Time</span>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm"
                />
              </label>
            </div>
          ) : (
            <p className="text-sm text-muted">
              This post was already {editingPost?.status}.
            </p>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!canEditSchedule}
              maxLength={100}
              className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm disabled:opacity-60"
              placeholder="Short title (#Shorts added automatically)"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={!canEditSchedule}
              className="w-full resize-none rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm disabled:opacity-60"
              placeholder="Optional description for YouTube"
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            {mode === "edit" && canEditSchedule ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void cancelPost()}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
            ) : null}
            {editingPost?.status === "failed" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void retryUpload()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-surface-hover disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Retry upload
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            {canEditSchedule ? (
              <button
                type="button"
                disabled={busy || (mode === "create" && !exportId)}
                onClick={() => void save()}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {mode === "edit" ? "Save" : "Schedule"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
