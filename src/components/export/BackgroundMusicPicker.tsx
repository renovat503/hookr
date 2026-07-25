"use client";

import { Loader2, Music2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LibraryMusic } from "@/lib/types";
import { cn } from "@/lib/utils";

type BackgroundMusicPickerProps = {
  tracks: LibraryMusic[];
  selectedMusicId: string | null;
  onSelectMusicId: (id: string | null) => void;
  musicVolume: number;
  onMusicVolumeChange: (value: number) => void;
  onUploaded?: () => void | Promise<void>;
  disabled?: boolean;
  className?: string;
};

function readAudioDuration(url: string) {
  return new Promise<number>((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () =>
      resolve(Math.max(1, Math.round(audio.duration || 0)));
    audio.onerror = () => resolve(0);
    audio.src = url;
  });
}

export function BackgroundMusicPicker({
  tracks,
  selectedMusicId,
  onSelectMusicId,
  musicVolume,
  onMusicVolumeChange,
  onUploaded,
  disabled = false,
  className,
}: BackgroundMusicPickerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLAudioElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const selectedTrack = tracks.find((track) => track.id === selectedMusicId);

  useEffect(() => {
    const audio = previewRef.current;
    if (!audio) return;
    audio.volume = musicVolume / 100;
  }, [musicVolume, selectedMusicId]);

  useEffect(() => {
    const audio = previewRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }, [selectedMusicId]);

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setUploadError("Please upload an audio file (MP3, M4A, WAV, etc.).");
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const blobUrl = URL.createObjectURL(file);
      const durationSeconds = await readAudioDuration(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const form = new FormData();
      form.append("file", file);
      form.append("durationSeconds", String(durationSeconds));

      const res = await fetch("/api/library/music", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as LibraryMusic & { error?: string };
      if (!res.ok) throw new Error(json.error || "Upload failed.");

      onSelectMusicId(json.id);
      await onUploaded?.();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted">Background music</span>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="audio/mpeg,audio/mp4,audio/wav,audio/*"
            className="hidden"
            disabled={disabled || uploading}
            onChange={(e) => {
              void handleUpload(e.target.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:border-muted disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Upload track
          </button>
        </div>
      </div>

      <label className="block space-y-2">
        <select
          value={selectedMusicId ?? ""}
          disabled={disabled}
          onChange={(e) => onSelectMusicId(e.target.value || null)}
          className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm outline-none focus:border-accent/50 disabled:opacity-50"
        >
          <option value="">No background music</option>
          {tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.name}
              {track.durationSeconds ? ` · ${track.durationSeconds}s` : ""}
            </option>
          ))}
        </select>
      </label>

      {selectedTrack ? (
        <>
          <div className="rounded-xl border border-accent/25 bg-accent/5 p-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <Music2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-accent">
                    Preview
                  </p>
                  <p className="truncate text-sm font-semibold text-foreground">
                    {selectedTrack.name}
                  </p>
                  {selectedTrack.durationSeconds ? (
                    <p className="text-[11px] text-muted">
                      {selectedTrack.durationSeconds}s track · listen before
                      you generate
                    </p>
                  ) : null}
                </div>
                <audio
                  ref={previewRef}
                  key={selectedTrack.id}
                  src={selectedTrack.url}
                  controls
                  preload="metadata"
                  className="h-9 w-full"
                />
              </div>
            </div>
          </div>

          <label className="block space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-muted">Music volume</span>
              <span className="font-mono text-foreground">{musicVolume}%</span>
            </div>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              disabled={disabled}
              value={musicVolume}
              onChange={(e) => onMusicVolumeChange(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
            <p className="text-[11px] text-muted">
              Preview volume matches export. Original clip audio stays at 85%
              when music is added.
            </p>
          </label>
        </>
      ) : (
        <p className="flex items-start gap-2 text-[11px] text-muted">
          <Music2 className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
          Upload a track once, then reuse it on any export. Use royalty-free
          music you have rights to.
        </p>
      )}

      {uploadError ? (
        <p className="text-xs text-danger">{uploadError}</p>
      ) : null}
    </div>
  );
}
