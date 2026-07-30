"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  formatSlotTimeLabel,
  POSTING_GOAL_PRESETS,
} from "@/lib/posting-slots";
import type { AccountPostingGoal } from "@/lib/types";
import { cn } from "@/lib/utils";

type PostingGoalPanelProps = {
  accountId: string;
  channelTitle: string;
  goal: AccountPostingGoal;
  disabled?: boolean;
  onSave: (goal: AccountPostingGoal) => void | Promise<void>;
};

const POSTS_PER_DAY_OPTIONS = [1, 2, 3, 4, 5, 6] as const;

export function PostingGoalPanel({
  accountId,
  channelTitle,
  goal,
  disabled = false,
  onSave,
}: PostingGoalPanelProps) {
  const [postsPerDay, setPostsPerDay] = useState(goal.postsPerDay);
  const [slotTimes, setSlotTimes] = useState(goal.slotTimes);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setPostsPerDay(goal.postsPerDay);
    setSlotTimes(goal.slotTimes);
    setDirty(false);
  }, [accountId, goal.postsPerDay, goal.slotTimes]);

  const applyPreset = (count: number) => {
    setPostsPerDay(count);
    setSlotTimes(POSTING_GOAL_PRESETS[count] ?? goal.slotTimes);
    setDirty(true);
  };

  const updateSlotTime = (index: number, value: string) => {
    setSlotTimes((current) =>
      current.map((time, idx) => (idx === index ? value : time)),
    );
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await onSave({ postsPerDay, slotTimes });
      setDirty(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-surface/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Posting goal</h3>
          <p className="text-xs text-muted">
            {channelTitle} · how many times per day and when
          </p>
        </div>
        <button
          type="button"
          disabled={disabled || busy || !dirty}
          onClick={() => void save()}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save goal
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {POSTS_PER_DAY_OPTIONS.map((count) => (
          <button
            key={count}
            type="button"
            disabled={disabled || busy}
            onClick={() => applyPreset(count)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium",
              postsPerDay === count
                ? "bg-accent text-accent-fg"
                : "border border-border text-muted hover:text-foreground",
            )}
          >
            {count}x / day
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {slotTimes.map((time, index) => (
          <label
            key={`${accountId}-${index}`}
            className="flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 py-2"
          >
            <span className="text-xs text-muted">Slot {index + 1}</span>
            <input
              type="time"
              value={time}
              disabled={disabled || busy}
              onChange={(e) => updateSlotTime(index, e.target.value)}
              className="ml-auto rounded-lg border border-border bg-surface px-2 py-1 text-xs"
            />
            <span className="hidden text-[11px] text-muted sm:inline">
              {formatSlotTimeLabel(time)}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
