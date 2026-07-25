"use client";

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { toPng } from "html-to-image";
import type { LibraryHook, OverlayStyle } from "@/lib/types";
import {
  CAPTION_FRAME,
  CaptionOverlay,
} from "@/components/hook/CaptionOverlay";
import { mergeOverlayStyle, hookNeedsOverlayBurn } from "@/lib/overlay-style";
import { DEFAULT_MUSIC_VOLUME } from "@/lib/constants";

/**
 * Renders the exact caption UI at 1080x1920 and returns a transparent PNG as base64 (no data-URL prefix).
 */
export async function captureCaptionPng(
  text: string,
  style: OverlayStyle,
): Promise<string | null> {
  if (!text.trim()) return null;

  const host = document.createElement("div");
  host.setAttribute("data-caption-capture", "true");
  host.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    `width:${CAPTION_FRAME.width}px`,
    `height:${CAPTION_FRAME.height}px`,
    "overflow:hidden",
    "pointer-events:none",
    "z-index:-1",
    "background:transparent",
  ].join(";");

  const frame = document.createElement("div");
  frame.style.cssText = [
    "position:relative",
    `width:${CAPTION_FRAME.width}px`,
    `height:${CAPTION_FRAME.height}px`,
    "background:transparent",
  ].join(";");
  host.appendChild(frame);
  document.body.appendChild(host);

  const root = createRoot(frame);
  root.render(createElement(CaptionOverlay, { text, style, frame: true }));

  await document.fonts?.ready.catch(() => undefined);
  if (style.fontFamily === "bricolage-grotesque") {
    try {
      await document.fonts.load(`800 ${style.fontSize || 48}px "Bricolage Grotesque"`);
      await document.fonts.load(`500 ${style.fontSize || 48}px "Bricolage Grotesque"`);
    } catch {
      // fall back to bundled variable font
    }
  }
  await new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r)),
  );

  try {
    const dataUrl = await toPng(frame, {
      width: CAPTION_FRAME.width,
      height: CAPTION_FRAME.height,
      pixelRatio: 1,
      cacheBust: true,
      backgroundColor: "transparent",
    });
    return dataUrl.split(",")[1] ?? null;
  } finally {
    root.unmount();
    host.remove();
  }
}

export async function captureOverlayForHook(
  hook: Pick<LibraryHook, "overlayText" | "overlayStyle">,
  text?: string,
): Promise<{ overlayStyle: OverlayStyle; overlayPngBase64: string | null }> {
  const caption = (text ?? hook.overlayText ?? "").trim();
  const overlayStyle = mergeOverlayStyle(hook.overlayStyle);
  if (!caption) {
    return { overlayStyle, overlayPngBase64: null };
  }
  return {
    overlayStyle,
    overlayPngBase64: await captureCaptionPng(caption, overlayStyle),
  };
}

export async function buildLibraryExportRequest(
  hook: LibraryHook,
  demoId: string,
  overlayText: string,
  options?: {
    musicId?: string | null;
    musicVolume?: number;
    overlayStyle?: Partial<OverlayStyle>;
  },
) {
  const text = overlayText.trim();
  const mergedStyle = mergeOverlayStyle({
    ...hook.overlayStyle,
    ...options?.overlayStyle,
  });
  const needsBurn = hookNeedsOverlayBurn({
    text,
    storedText: hook.overlayText,
    overlayBurned: hook.overlayBurned,
    storedStyle: hook.overlayStyle,
    requestedStyle: options?.overlayStyle ?? mergedStyle,
  });

  const payload: Record<string, unknown> = {
    hookId: hook.id,
    demoId,
    overlayText,
  };

  if (needsBurn && text) {
    const { overlayStyle, overlayPngBase64 } = await captureOverlayForHook(
      { ...hook, overlayStyle: mergedStyle },
      text,
    );
    if (!overlayPngBase64) {
      throw new Error("Could not render caption styling for export.");
    }
    payload.overlayStyle = overlayStyle;
    payload.overlayPngBase64 = overlayPngBase64;
  } else if (options?.overlayStyle) {
    payload.overlayStyle = mergedStyle;
  }

  if (options?.musicId) {
    payload.musicId = options.musicId;
    payload.musicVolume = options.musicVolume ?? DEFAULT_MUSIC_VOLUME;
  }

  return payload;
}
