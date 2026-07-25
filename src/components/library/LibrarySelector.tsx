"use client";

import { useRef, useState } from "react";
import { FolderOpen, Upload } from "lucide-react";
import { MediaPlayer } from "@/components/ui/ReelPlayer";
import type { DemoClip } from "@/lib/types";
import { cn } from "@/lib/utils";
import { uploadDemoClip } from "@/lib/upload-demo";

type LibrarySelectorProps = {
  clips: DemoClip[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpload?: (clip: DemoClip) => void;
  disabled?: boolean;
};

export function LibrarySelector({
  clips,
  selectedId,
  onSelect,
  onUpload,
  disabled,
}: LibrarySelectorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const readDuration = (url: string) =>
    new Promise<number>((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        resolve(Math.max(1, Math.round(video.duration || 0)));
      };
      video.onerror = () => resolve(0);
      video.src = url;
    });

  const handleUpload = async (file: File | undefined) => {
    setUploadError(null);
    if (!file) return;

    if (!file.type.startsWith("video/")) {
      setUploadError("Please upload an MP4, MOV, or another video file.");
      return;
    }

    try {
      const blobUrl = URL.createObjectURL(file);
      const durationSeconds = await readDuration(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const res = await uploadDemoClip(file, durationSeconds);
      const data = (await res.json()) as DemoClip & { error?: string };
      if (!res.ok) throw new Error(data.error || "Upload failed.");

      const clip: DemoClip = {
        id: data.id,
        name: data.name,
        durationSeconds: data.durationSeconds,
        thumbnailUrl: null,
        url: data.url,
        uploadedAt: data.uploadedAt,
      };

      onUpload?.(clip);
      onSelect(clip.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    }
  };

  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-surface/70 p-5",
        disabled && "opacity-70",
      )}
    >
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight">
            Demo library
          </h2>
          <p className="mt-1 text-sm text-muted">
            Choose a pre-recorded product clip to append after the hook.
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="video/mp4,video/quicktime,video/*"
          className="hidden"
          onChange={(e) => {
            void handleUpload(e.target.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!onUpload}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-muted"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload
        </button>
      </div>

      {uploadError && (
        <p className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {uploadError}
        </p>
      )}

      {clips.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-14 text-muted">
          <FolderOpen className="h-8 w-8 opacity-40" />
          <p className="text-sm">No demo clips yet</p>
          <p className="text-xs">Upload MP4 / MOV product recordings</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clips.map((clip) => {
            const selected = selectedId === clip.id;
            return (
              <li key={clip.id}>
                <button
                  type="button"
                  onClick={() => onSelect(clip.id)}
                  className={cn(
                    "w-full overflow-hidden rounded-xl border text-left transition-all",
                    selected
                      ? "border-accent ring-1 ring-accent/40"
                      : "border-border hover:border-muted",
                  )}
                >
                  {clip.url ? (
                    <MediaPlayer
                      frameClassName="bg-surface-raised"
                      src={clip.url}
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <div className="aspect-video bg-surface-raised">
                      {clip.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={clip.thumbnailUrl}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-gradient-to-br from-sky-900/40 to-surface-raised text-xs text-demo">
                          Demo clip
                        </div>
                      )}
                    </div>
                  )}
                  <div className="p-3">
                    <p className="truncate text-sm font-medium">{clip.name}</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {clip.durationSeconds}s · uploaded{" "}
                      {new Date(clip.uploadedAt).toLocaleDateString()}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
