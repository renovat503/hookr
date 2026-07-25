"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { captureCaptionPng } from "@/lib/capture-caption";
import { filenameFromMediaUrl } from "@/lib/download-media";
import { DownloadButton } from "@/components/ui/DownloadButton";
import { hookNeedsOverlayBurn } from "@/lib/overlay-style";
import { cn } from "@/lib/utils";
import { DEFAULT_MUSIC_VOLUME } from "@/lib/constants";
import type { OverlayStyle } from "@/lib/types";

type ExportModalProps = {
  open: boolean;
  onClose: () => void;
  hookUrl: string | null;
  demoUrl: string | null;
  hookActionPrompt?: string;
  demoName?: string;
  overlayText?: string;
  overlayStyle?: OverlayStyle;
  /** When true, caption is already baked into hookUrl and text/style unchanged */
  overlayBurned?: boolean;
  musicId?: string | null;
  musicVolume?: number;
};

export function ExportModal({
  open,
  onClose,
  hookUrl,
  demoUrl,
  hookActionPrompt,
  demoName,
  overlayText,
  overlayStyle,
  overlayBurned = false,
  musicId,
  musicVolume = DEFAULT_MUSIC_VOLUME,
}: ExportModalProps) {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setProgress(0);
      setDone(false);
      setExportUrl(null);
      setError(null);
      return;
    }

    if (!hookUrl || !demoUrl) {
      setError("Hook and demo clip are required.");
      return;
    }

    setProgress(0);
    setDone(false);
    setExportUrl(null);
    setError(null);

    let cancelled = false;

    const run = async () => {
      const tick = window.setInterval(() => {
        setProgress((p) => Math.min(92, p + Math.random() * 10 + 4));
      }, 280);

      try {
        const caption = overlayText?.trim() ?? "";
        const needsBurn = hookNeedsOverlayBurn({
          text: caption,
          storedText: caption,
          overlayBurned,
          storedStyle: overlayStyle,
          requestedStyle: overlayStyle,
        });
        const overlayPngBase64 =
          needsBurn && caption && overlayStyle
            ? await captureCaptionPng(caption, overlayStyle)
            : null;
        if (needsBurn && caption && !overlayPngBase64) {
          throw new Error("Could not render caption styling for export.");
        }

        const res = await fetch("/api/library/exports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hookUrl,
            demoUrl,
            hookActionPrompt,
            demoName,
            overlayText,
            overlayStyle,
            overlayPngBase64,
            musicId: musicId || undefined,
            musicVolume,
          }),
        });
        const data = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !data.url) {
          throw new Error(data.error || "Export failed.");
        }
        if (!cancelled) {
          window.clearInterval(tick);
          setProgress(100);
          setExportUrl(data.url);
          setDone(true);
        }
      } catch (err) {
        if (!cancelled) {
          window.clearInterval(tick);
          setError(err instanceof Error ? err.message : "Export failed.");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [open, hookUrl, demoUrl, hookActionPrompt, demoName, overlayText, overlayStyle, overlayBurned, musicId, musicVolume]);

  const clamped = Math.min(100, Math.round(progress));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Close overlay"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl"
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 rounded-lg p-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>

            <h2
              id="export-title"
              className="font-display text-xl font-semibold tracking-tight"
            >
              {error
                ? "Export failed"
                : done
                  ? "Saved to library"
                  : "Rendering final video"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {error
                ? error
                : done
                  ? "Your stitched clip is ready. Find it on the Instagram tab or in your Produce run folder."
                  : "Burning captions, concatenating hook + demo, mixing audio, and applying unique variations…"}
            </p>

            {!error && (
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="text-muted">
                    {done ? "Complete" : "Processing"}
                  </span>
                  <span className="font-mono text-foreground">{clamped}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-raised">
                  <motion.div
                    className="h-full rounded-full bg-accent"
                    animate={{ width: `${clamped}%` }}
                    transition={{ ease: "easeOut", duration: 0.2 }}
                  />
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3">
              {done && exportUrl ? (
                <>
                  <DownloadButton
                    url={exportUrl}
                    filename={filenameFromMediaUrl(exportUrl, "finished-short.mp4")}
                    label="Download Video"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-fg transition-all hover:brightness-110 hover:text-accent-fg"
                    iconClassName="h-4 w-4"
                  />
                  <Link
                    href="/library"
                    onClick={onClose}
                    className="inline-flex items-center justify-center rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm font-medium transition-colors hover:border-muted"
                  >
                    View in Library
                  </Link>
                </>
              ) : error ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm font-medium"
                >
                  Close
                </button>
              ) : (
                <div className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Rendering…
                </div>
              )}
            </div>

            {done && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 flex items-center gap-2 text-xs text-accent"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Export saved with captions + demo
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
