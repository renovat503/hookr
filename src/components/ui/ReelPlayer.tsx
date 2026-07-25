"use client";

import { cn } from "@/lib/utils";
import type { ComponentPropsWithoutRef } from "react";

const REEL_FRAME_SIZE = {
  /** ~112px tall thumbnails */
  xs: "h-28 w-auto max-w-full",
  /** Library cards (~288px tall) */
  sm: "w-[10.125rem] max-w-full",
  /** Compact previews */
  md: "w-full max-w-[9rem]",
  mdLg: "w-full max-w-[10rem]",
  /** Hook builder sidebar */
  lg: "w-full max-w-[260px]",
  /** Large preview panes */
  xl: "h-[28rem] w-auto max-w-full",
} as const;

export type ReelPlayerSize = keyof typeof REEL_FRAME_SIZE;

type ReelPlayerProps = ComponentPropsWithoutRef<"video"> & {
  size?: ReelPlayerSize;
  frameClassName?: string;
};

export function ReelPlayer({
  size = "sm",
  frameClassName,
  className,
  ...videoProps
}: ReelPlayerProps) {
  return (
    <div
      className={cn(
        "relative mx-auto aspect-[9/16] overflow-hidden bg-black",
        REEL_FRAME_SIZE[size],
        frameClassName,
      )}
    >
      <video
        {...videoProps}
        className={cn("reel-video h-full w-full object-contain", className)}
      />
    </div>
  );
}

type MediaPlayerProps = ComponentPropsWithoutRef<"video"> & {
  aspect?: "video" | "reel";
  frameClassName?: string;
};

/** Landscape demo clips and other non-reel video */
export function MediaPlayer({
  aspect = "video",
  frameClassName,
  className,
  ...videoProps
}: MediaPlayerProps) {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-black",
        aspect === "video" ? "aspect-video" : "aspect-[9/16]",
        frameClassName,
      )}
    >
      <video
        {...videoProps}
        className={cn("reel-video h-full w-full object-contain", className)}
      />
    </div>
  );
}

export function reelFrameClass(size: ReelPlayerSize = "sm", extra?: string) {
  return cn(
    "relative mx-auto aspect-[9/16] overflow-hidden bg-black",
    REEL_FRAME_SIZE[size],
    extra,
  );
}

export const reelVideoClass = "reel-video h-full w-full object-contain";
