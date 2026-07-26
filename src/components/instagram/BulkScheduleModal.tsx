"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { ReelPlayer } from "@/components/ui/ReelPlayer";
import { resolveScheduleCaption } from "@/lib/instagram-queue";
import { formatSlotTimeLabel, type ScheduleSlot } from "@/lib/posting-slots";
import type { LibraryExport } from "@/lib/types";
import { cn } from "@/lib/utils";

export type BulkScheduleAssignment = {
  exportId: string;
  dateIso: string;
  time: string;
  scheduledAt: string;
  caption: string;
};

type BulkScheduleModalProps = {
  open: boolean;
  accountId: string;
  accountUsername: string;
  exports: LibraryExport[];
  previewSlots: ScheduleSlot[];
  onClose: () => void;
  onConfirm: (
    assignments: BulkScheduleAssignment[],
    defaultCaption: string,
  ) => void | Promise<void>;
};

function defaultCaptionStorageKey(accountId: string) {
  return `hookr-bulk-caption-${accountId}`;
}

function captionForExport(
  exp: LibraryExport,
  defaultCaption: string,
  captions: Record<string, string>,
  exportId: string,
) {
  if (exportId in captions) return captions[exportId] ?? "";
  return resolveScheduleCaption(exp, null, defaultCaption);
}

export function BulkScheduleModal({
  open,
  accountId,
  accountUsername,
  exports,
  previewSlots,
  onClose,
  onConfirm,
}: BulkScheduleModalProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [defaultCaption, setDefaultCaption] = useState("");
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [customized, setCustomized] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportById = useMemo(
    () => new Map(exports.map((exp) => [exp.id, exp])),
    [exports],
  );

  const selectedPreview = useMemo(
    () => previewSlots.slice(0, selected.length),
    [previewSlots, selected.length],
  );

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setCaptions({});
    setCustomized(new Set());
    setError(null);
    if (accountId) {
      try {
        setDefaultCaption(
          localStorage.getItem(defaultCaptionStorageKey(accountId)) ?? "",
        );
      } catch {
        setDefaultCaption("");
      }
    } else {
      setDefaultCaption("");
    }
  }, [open, accountId]);

  const persistDefaultCaption = (value: string) => {
    if (!accountId) return;
    try {
      if (value.trim()) {
        localStorage.setItem(defaultCaptionStorageKey(accountId), value);
      } else {
        localStorage.removeItem(defaultCaptionStorageKey(accountId));
      }
    } catch {
      // ignore storage errors
    }
  };

  const applyDefaultToSelected = (value: string, onlyUncustomized = true) => {
    setCaptions((current) => {
      const next = { ...current };
      for (const exportId of selected) {
        if (onlyUncustomized && customized.has(exportId)) continue;
        const exp = exportById.get(exportId);
        next[exportId] = exp
          ? resolveScheduleCaption(exp, null, value)
          : value.trim();
      }
      return next;
    });
  };

  const handleDefaultCaptionChange = (value: string) => {
    setDefaultCaption(value);
    applyDefaultToSelected(value);
  };

  if (!open) return null;

  const toggle = (exportId: string) => {
    setSelected((current) => {
      const checked = current.includes(exportId);
      if (checked) {
        setCaptions((prev) => {
          const next = { ...prev };
          delete next[exportId];
          return next;
        });
        setCustomized((prev) => {
          const next = new Set(prev);
          next.delete(exportId);
          return next;
        });
        return current.filter((id) => id !== exportId);
      }

      const exp = exportById.get(exportId);
      if (exp) {
        setCaptions((prev) => ({
          ...prev,
          [exportId]: resolveScheduleCaption(exp, null, defaultCaption),
        }));
      }
      return [...current, exportId];
    });
  };

  const selectAll = () => {
    const max = Math.min(exports.length, previewSlots.length);
    const ids = exports.slice(0, max).map((exp) => exp.id);
    setSelected(ids);
    setCaptions(
      Object.fromEntries(
        ids.map((id) => {
          const exp = exportById.get(id);
          return [id, exp ? resolveScheduleCaption(exp, null, defaultCaption) : ""];
        }),
      ),
    );
    setCustomized(new Set());
  };

  const updateVideoCaption = (exportId: string, value: string) => {
    setCaptions((prev) => ({ ...prev, [exportId]: value }));
    setCustomized((prev) => new Set(prev).add(exportId));
  };

  const resetVideoCaption = (exportId: string) => {
    const exp = exportById.get(exportId);
    if (!exp) return;
    setCaptions((prev) => ({
      ...prev,
      [exportId]: resolveScheduleCaption(exp, null, defaultCaption),
    }));
    setCustomized((prev) => {
      const next = new Set(prev);
      next.delete(exportId);
      return next;
    });
  };

  const confirm = async () => {
    if (!selected.length) {
      setError("Select at least one video.");
      return;
    }
    if (selected.length > previewSlots.length) {
      setError(`Only ${previewSlots.length} open slots are available.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const assignments: BulkScheduleAssignment[] = selected
        .map((exportId, index) => {
          const slot = selectedPreview[index];
          const exp = exportById.get(exportId);
          if (!slot || !exp) return null;
          return {
            exportId,
            dateIso: slot.dateIso,
            time: slot.time,
            scheduledAt: slot.scheduledAt.toISOString(),
            caption: resolveScheduleCaption(
              exp,
              captions[exportId],
              defaultCaption,
            ),
          };
        })
        .filter((item): item is BulkScheduleAssignment => item !== null);

      await onConfirm(assignments, defaultCaption);
      persistDefaultCaption(defaultCaption);
      setSelected([]);
      setCaptions({});
      setCustomized(new Set());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk schedule failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Bulk schedule</h2>
            <p className="text-xs text-muted">
              @{accountUsername} · fills the next open calendar slots
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-hover"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          {error ? (
            <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="bulk-default-caption"
                className="text-sm font-medium"
              >
                Default description
              </label>
              {selected.length > 0 ? (
                <button
                  type="button"
                  onClick={() => applyDefaultToSelected(defaultCaption, false)}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  Apply to all selected
                </button>
              ) : null}
            </div>
            <textarea
              id="bulk-default-caption"
              value={defaultCaption}
              onChange={(e) => handleDefaultCaptionChange(e.target.value)}
              onBlur={() => persistDefaultCaption(defaultCaption)}
              rows={3}
              placeholder="Used for every selected video. You can edit each one below."
              className="w-full resize-y rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm outline-none ring-accent focus:ring-2"
            />
            <p className="text-xs text-muted">
              Saved for this account. New selections pick this up automatically.
            </p>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted">
              {previewSlots.length} open slots · {exports.length} videos available
            </p>
            <button
              type="button"
              onClick={selectAll}
              className="text-xs font-medium text-accent hover:underline"
            >
              Select next {Math.min(exports.length, previewSlots.length)}
            </button>
          </div>

          {exports.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              No finished videos available for this account.
            </p>
          ) : (
            <ul className="max-h-[min(24rem,50dvh)] space-y-2 overflow-y-auto">
              {exports.map((exp, index) => {
                const checked = selected.includes(exp.id);
                const slotIndex = selected.indexOf(exp.id);
                const slot = slotIndex >= 0 ? selectedPreview[slotIndex] : null;
                const disabled =
                  !checked &&
                  selected.length >= previewSlots.length &&
                  previewSlots.length > 0;
                const isCustomized = customized.has(exp.id);

                return (
                  <li key={exp.id}>
                    <div
                      className={cn(
                        "rounded-xl border p-2",
                        checked
                          ? "border-accent bg-accent/10"
                          : "border-border bg-surface-raised",
                        disabled && "opacity-50",
                      )}
                    >
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-3",
                          disabled && "cursor-not-allowed",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(exp.id)}
                          className="accent-accent"
                        />
                        <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg">
                          <ReelPlayer
                            size="xs"
                            src={exp.url}
                            controls={false}
                            playsInline
                            preload="metadata"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{exp.name}</p>
                          {checked && slot ? (
                            <p className="text-xs text-muted">
                              Slot {slotIndex + 1}: {slot.dateIso} ·{" "}
                              {formatSlotTimeLabel(slot.time)}
                            </p>
                          ) : (
                            <p className="text-xs text-muted">Video {index + 1}</p>
                          )}
                        </div>
                      </label>

                      {checked ? (
                        <div className="mt-2 space-y-1.5 pl-7">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-muted">
                              Description
                              {isCustomized ? (
                                <span className="ml-1 text-accent">· edited</span>
                              ) : null}
                            </span>
                            {isCustomized ? (
                              <button
                                type="button"
                                onClick={() => resetVideoCaption(exp.id)}
                                className="text-xs text-muted hover:text-foreground"
                              >
                                Reset to default
                              </button>
                            ) : null}
                          </div>
                          <textarea
                            value={captionForExport(
                              exp,
                              defaultCaption,
                              captions,
                              exp.id,
                            )}
                            onChange={(e) =>
                              updateVideoCaption(exp.id, e.target.value)
                            }
                            rows={2}
                            placeholder="Instagram caption for this video"
                            className="w-full resize-y rounded-lg border border-border bg-surface px-2.5 py-2 text-sm outline-none ring-accent focus:ring-2"
                          />
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border border-border px-4 py-2 text-sm text-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !selected.length}
            onClick={() => void confirm()}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Schedule {selected.length || ""} video
            {selected.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
