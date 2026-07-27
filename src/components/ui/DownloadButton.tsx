"use client";

import { useState } from "react";
import { Check, Download, Loader2 } from "lucide-react";
import { markExportDownloaded } from "@/lib/downloaded-exports";
import { downloadMedia, filenameFromMediaUrl } from "@/lib/download-media";
import { cn } from "@/lib/utils";

type DownloadButtonProps = {
  url: string;
  filename?: string;
  label?: string;
  className?: string;
  iconClassName?: string;
  /** When set, marks this export as downloaded in local storage on success */
  trackingId?: string;
  downloaded?: boolean;
  onDownloaded?: (trackingId: string) => void;
};

export function DownloadButton({
  url,
  filename,
  label = "Download",
  className,
  iconClassName = "h-3.5 w-3.5",
  trackingId,
  downloaded = false,
  onDownloaded,
}: DownloadButtonProps) {
  const [busy, setBusy] = useState(false);
  const displayLabel = downloaded && label === "Download" ? "Download again" : label;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        void (async () => {
          setBusy(true);
          try {
            await downloadMedia(
              url,
              filename ?? filenameFromMediaUrl(url),
              trackingId,
            );
            if (trackingId) {
              markExportDownloaded(trackingId);
              onDownloaded?.(trackingId);
            }
          } catch (err) {
            window.alert(
              err instanceof Error ? err.message : "Download failed.",
            );
          } finally {
            setBusy(false);
          }
        })();
      }}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium hover:text-accent disabled:opacity-50",
        downloaded ? "text-muted hover:text-foreground" : "text-foreground",
        className,
      )}
    >
      {busy ? (
        <Loader2 className={cn(iconClassName, "animate-spin")} />
      ) : downloaded ? (
        <Check className={cn(iconClassName, "text-sky-400")} />
      ) : (
        <Download className={iconClassName} />
      )}
      {displayLabel}
    </button>
  );
}
