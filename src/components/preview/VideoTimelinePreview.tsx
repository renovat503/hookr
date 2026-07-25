"use client";

import { motion } from "framer-motion";
import type { DemoClip, HookConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

type VideoTimelinePreviewProps = {
  hook: HookConfig;
  demo: DemoClip | null;
  className?: string;
};

export function VideoTimelinePreview({
  hook,
  demo,
  className,
}: VideoTimelinePreviewProps) {
  const hookReady = Boolean(hook.generatedClipUrl);
  const demoReady = Boolean(demo);
  const totalSeconds = 4 + (demo?.durationSeconds ?? 0);

  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-surface/70 p-5",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight">
            Timeline
          </h2>
          <p className="mt-1 text-sm text-muted">
            Hook + demo sequence · {totalSeconds || 4}s total
          </p>
        </div>
      </div>

      <div className="relative h-16 overflow-hidden rounded-xl border border-border bg-surface-raised">
        <div className="absolute inset-0 flex">
          <motion.div
            layout
            className={cn(
              "relative flex items-center justify-center border-r border-black/30",
              hookReady ? "bg-hook/25" : "bg-surface-hover",
            )}
            style={{ flex: demoReady ? "0 0 28%" : "1 1 auto" }}
          >
            <span className="text-[11px] font-semibold text-hook">
              Hook · 4s
            </span>
            {hook.overlayText && (
              <span className="absolute bottom-1 left-2 right-2 truncate text-[9px] text-white/50">
                {hook.overlayText}
              </span>
            )}
          </motion.div>

          <motion.div
            layout
            className={cn(
              "relative flex flex-1 items-center justify-center",
              demoReady ? "bg-demo/20" : "bg-transparent",
            )}
          >
            <span
              className={cn(
                "text-[11px] font-semibold",
                demoReady ? "text-demo" : "text-muted",
              )}
            >
              {demoReady
                ? `Demo · ${demo!.durationSeconds}s`
                : "Select a demo clip"}
            </span>
          </motion.div>
        </div>
      </div>

      <div className="mt-3 flex justify-between text-[10px] text-muted">
        <span>0:00</span>
        <span>0:05</span>
        <span>
          0:{String(Math.min(totalSeconds, 59)).padStart(2, "0")}
        </span>
      </div>
    </section>
  );
}
