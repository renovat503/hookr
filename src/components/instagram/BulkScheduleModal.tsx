"use client";

import { useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { ReelPlayer } from "@/components/ui/ReelPlayer";
import { formatSlotTimeLabel, type ScheduleSlot } from "@/lib/posting-slots";
import type { LibraryExport } from "@/lib/types";
import { cn } from "@/lib/utils";

export type BulkScheduleAssignment = {
  exportId: string;
  dateIso: string;
  time: string;
  scheduledAt: string;
};

type BulkScheduleModalProps = {
  open: boolean;
  accountUsername: string;
  exports: LibraryExport[];
  previewSlots: ScheduleSlot[];
  onClose: () => void;
  onConfirm: (assignments: BulkScheduleAssignment[]) => void | Promise<void>;
};

export function BulkScheduleModal({
  open,
  accountUsername,
  exports,
  previewSlots,
  onClose,
  onConfirm,
}: BulkScheduleModalProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPreview = useMemo(
    () => previewSlots.slice(0, selected.length),
    [previewSlots, selected.length],
  );

  if (!open) return null;

  const toggle = (exportId: string) => {
    setSelected((current) =>
      current.includes(exportId)
        ? current.filter((id) => id !== exportId)
        : [...current, exportId],
    );
  };

  const selectAll = () => {
    const max = Math.min(exports.length, previewSlots.length);
    setSelected(exports.slice(0, max).map((exp) => exp.id));
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
          if (!slot) return null;
          return {
            exportId,
            dateIso: slot.dateIso,
            time: slot.time,
            scheduledAt: slot.scheduledAt.toISOString(),
          };
        })
        .filter((item): item is BulkScheduleAssignment => item !== null);

      await onConfirm(assignments);
      setSelected([]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk schedule failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
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
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {exports.map((exp, index) => {
                const checked = selected.includes(exp.id);
                const slotIndex = selected.indexOf(exp.id);
                const slot = slotIndex >= 0 ? selectedPreview[slotIndex] : null;
                const disabled =
                  !checked &&
                  selected.length >= previewSlots.length &&
                  previewSlots.length > 0;

                return (
                  <li key={exp.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-xl border p-2",
                        checked
                          ? "border-accent bg-accent/10"
                          : "border-border bg-surface-raised",
                        disabled && "cursor-not-allowed opacity-50",
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
