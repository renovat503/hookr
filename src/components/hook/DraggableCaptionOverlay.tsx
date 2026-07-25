"use client";

import { useCallback, useRef, useState } from "react";
import type { OverlayStyle } from "@/lib/types";
import {
  clampPercent,
  resolveOverlayPosition,
} from "@/lib/overlay-position";
import { cn } from "@/lib/utils";
import {
  CAPTION_FRAME,
  CAPTION_SIDE_MARGIN_PX,
  CaptionTextContent,
  captionBandStyle,
  captionParagraphStyle,
  overlayPaddingClass,
  overlayStyleClass,
} from "./CaptionOverlay";

type DraggableCaptionOverlayProps = {
  text: string;
  style: OverlayStyle;
  onPositionChange: (position: { x: number; y: number }) => void;
  className?: string;
};

export function DraggableCaptionOverlay({
  text,
  style,
  onPositionChange,
  className,
}: DraggableCaptionOverlayProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const draggingActive = useRef(false);
  const [dragging, setDragging] = useState(false);

  const updateFromClient = useCallback(
    (clientY: number) => {
      const frame = frameRef.current;
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      if (rect.height <= 0) return;

      const y = clampPercent(((clientY - rect.top) / rect.height) * 100);
      onPositionChange({ x: 50, y });
    },
    [onPositionChange],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!text.trim()) return;
      draggingActive.current = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      updateFromClient(event.clientY);
    },
    [text, updateFromClient],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingActive.current) return;
      updateFromClient(event.clientY);
    },
    [updateFromClient],
  );

  const stopDragging = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingActive.current) return;
      draggingActive.current = false;
      setDragging(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [],
  );

  if (!text.trim()) return null;

  const position = resolveOverlayPosition(style);

  return (
    <div
      ref={frameRef}
      className={cn("absolute inset-0 touch-none", className)}
      style={{
        width: CAPTION_FRAME.width,
        height: CAPTION_FRAME.height,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label="Drag caption to reposition vertically"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        className={cn(
          "absolute select-none",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        style={{
          left: CAPTION_SIDE_MARGIN_PX,
          right: CAPTION_SIDE_MARGIN_PX,
          ...captionBandStyle(position.y),
        }}
      >
        <p
          className={cn(
            overlayPaddingClass(style),
            overlayStyleClass(style),
            "w-full",
          )}
          style={{
            ...captionParagraphStyle(style),
            pointerEvents: "none",
          }}
        >
          <CaptionTextContent text={text} style={style} />
        </p>
      </div>
    </div>
  );
}

export { CAPTION_FRAME };
