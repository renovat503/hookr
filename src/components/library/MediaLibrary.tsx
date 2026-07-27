"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  Download,
  Loader2,
  MessageSquareText,
  Music2,
  Share2,
  Sparkles,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { CaptionLibraryPanel } from "@/components/library/CaptionLibraryPanel";
import { DownloadButton } from "@/components/ui/DownloadButton";
import { MediaPlayer, ReelPlayer } from "@/components/ui/ReelPlayer";
import {
  downloadMediaBulk,
  exportDownloadFilename,
  type BulkDownloadProgress,
} from "@/lib/download-media";
import {
  getDownloadCounts,
  markExportDownloaded,
} from "@/lib/downloaded-exports";
import type { Campaign, LibraryData, LibraryExport } from "@/lib/types";
import { hookCopyLabel } from "@/lib/campaign-hooks";
import { cn, friendlyFetchError, isCompleteHook, safeUploadFilename } from "@/lib/utils";
import { uploadDemoClip, LARGE_DEMO_BYTES } from "@/lib/upload-demo";

type Tab = "hooks" | "demos" | "music" | "motions" | "captions" | "exports";

const EXPORT_BATCH_SIZES = [60, 120, 180] as const;

const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: "hooks", label: "Hooks", icon: Sparkles },
  { id: "demos", label: "Demos", icon: Upload },
  { id: "exports", label: "Exports", icon: Share2 },
  { id: "motions", label: "Motions", icon: Clapperboard },
  { id: "music", label: "Music", icon: Music2 },
  { id: "captions", label: "Captions", icon: MessageSquareText },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Video;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-16 text-muted">
      <Icon className="h-10 w-10 opacity-30" />
      <p className="text-sm font-medium text-foreground/80">{title}</p>
      <p className="max-w-xs text-center text-xs">{hint}</p>
    </div>
  );
}

function UploadTabButton({
  label,
  icon: Icon,
  loading,
  onClick,
}: {
  label: string;
  icon: typeof Sparkles;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-sm font-medium transition-colors hover:border-muted disabled:opacity-50"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Icon className="h-4 w-4" />
      )}
      {label}
    </button>
  );
}

type MediaLibraryProps = {
  initialTab?: Tab;
  /** Caption library tab — hidden when false */
  showCaptionsTab?: boolean;
};

export function MediaLibrary({
  initialTab = "hooks",
  showCaptionsTab = true,
}: MediaLibraryProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [data, setData] = useState<LibraryData | null>(null);
  const [exports, setExports] = useState<LibraryExport[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [demoUploadNote, setDemoUploadNote] = useState<string | null>(null);
  const [uploadingHook, setUploadingHook] = useState(false);
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [uploadingMotion, setUploadingMotion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingMusicId, setDeletingMusicId] = useState<string | null>(null);
  const [deletingDemoId, setDeletingDemoId] = useState<string | null>(null);
  const [deletingHookId, setDeletingHookId] = useState<string | null>(null);
  const [deletingMotionId, setDeletingMotionId] = useState<string | null>(null);
  const [deletingExportId, setDeletingExportId] = useState<string | null>(null);
  const [selectedExportIds, setSelectedExportIds] = useState<string[]>([]);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [bulkDownloadProgress, setBulkDownloadProgress] =
    useState<BulkDownloadProgress | null>(null);
  const [downloadCounts, setDownloadCounts] = useState<Record<string, number>>(
    () => ({}),
  );
  const [savingMotionHookId, setSavingMotionHookId] = useState<string | null>(
    null,
  );
  const [captionCount, setCaptionCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const hookFileRef = useRef<HTMLInputElement>(null);
  const musicFileRef = useRef<HTMLInputElement>(null);
  const motionFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDownloadCounts(getDownloadCounts());
  }, []);

  useEffect(() => {
    if (tab !== "exports") {
      setSelectedExportIds([]);
      setBulkDownloadProgress(null);
    }
  }, [tab]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const campRes = await fetch("/api/campaigns", {
        signal: AbortSignal.timeout(35_000),
      });
      let activeId: string | null = null;
      if (campRes.ok) {
        const campJson = (await campRes.json()) as {
          campaigns?: Campaign[];
          activeId?: string | null;
        };
        setCampaigns(campJson.campaigns ?? []);
        activeId = campJson.activeId ?? null;
        const active = activeId
          ? campJson.campaigns?.find((c) => c.id === activeId) ?? null
          : null;
        setActiveCampaign(active);
      }

      const assetsUrl = activeId
        ? `/api/library?scope=assets&campaignId=${encodeURIComponent(activeId)}`
        : "/api/library?scope=assets";

      const [libRes, expRes, capRes] = await Promise.all([
        fetch(assetsUrl, { signal: AbortSignal.timeout(35_000) }),
        fetch("/api/library?scope=exports", {
          signal: AbortSignal.timeout(35_000),
        }),
        fetch("/api/library/captions", {
          signal: AbortSignal.timeout(35_000),
        }),
      ]);
      if (!libRes.ok) {
        const body = (await libRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Could not load library.");
      }
      setData((await libRes.json()) as LibraryData);
      if (expRes.ok) {
        const expJson = (await expRes.json()) as LibraryData;
        setExports(expJson.exports ?? []);
      }
      if (capRes.ok) {
        const capJson = (await capRes.json()) as {
          count?: number;
          captions?: unknown[];
        };
        setCaptionCount(capJson.count ?? capJson.captions?.length ?? 0);
      }
    } catch (err) {
      setError(friendlyFetchError(err, "Load failed."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const readDuration = (url: string) =>
    new Promise<number>((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () =>
        resolve(Math.max(1, Math.round(video.duration || 0)));
      video.onerror = () => resolve(0);
      video.src = url;
    });

  const handleHookUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setError("Please upload a video file.");
      return;
    }

    setUploadingHook(true);
    setError(null);
    try {
      const blobUrl = URL.createObjectURL(file);
      const durationSeconds = await readDuration(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const form = new FormData();
      form.append("file", file, safeUploadFilename(file.name));
      form.append("durationSeconds", String(durationSeconds));

      const res = await fetch("/api/library/hooks", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Upload failed.");

      await load();
      setTab("hooks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadingHook(false);
    }
  };

  const handleDemoUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setError("Please upload a video file.");
      return;
    }

    setUploading(true);
    setError(null);
    setDemoUploadNote(
      file.size > LARGE_DEMO_BYTES
        ? "Large video — uploading and compressing on the server. This can take a few minutes; keep this tab open."
        : null,
    );
    try {
      const blobUrl = URL.createObjectURL(file);
      const durationSeconds = await readDuration(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const res = await uploadDemoClip(file, durationSeconds);
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Upload failed.");

      await load();
      setTab("demos");
    } catch (err) {
      setError(friendlyFetchError(err, "Upload failed."));
    } finally {
      setUploading(false);
      setDemoUploadNote(null);
    }
  };

  const handleMotionUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setError("Please upload a video file.");
      return;
    }

    setUploadingMotion(true);
    setError(null);
    try {
      const blobUrl = URL.createObjectURL(file);
      const durationSeconds = await readDuration(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const form = new FormData();
      form.append("file", file, safeUploadFilename(file.name));
      form.append("durationSeconds", String(durationSeconds));

      const res = await fetch("/api/library/motions", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Upload failed.");

      await load();
      setTab("motions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadingMotion(false);
    }
  };

  const saveHookAsMotion = async (hookId: string) => {
    setSavingMotionHookId(hookId);
    setError(null);
    try {
      const res = await fetch("/api/library/motions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hookId }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not save motion.");
      await load();
      setTab("motions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save motion.");
    } finally {
      setSavingMotionHookId(null);
    }
  };

  const handleMusicUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setError("Please upload an audio file.");
      return;
    }

    setUploadingMusic(true);
    setError(null);
    try {
      const blobUrl = URL.createObjectURL(file);
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      const durationSeconds = await new Promise<number>((resolve) => {
        audio.onloadedmetadata = () =>
          resolve(Math.max(1, Math.round(audio.duration || 0)));
        audio.onerror = () => resolve(0);
        audio.src = blobUrl;
      });
      URL.revokeObjectURL(blobUrl);

      const form = new FormData();
      form.append("file", file, safeUploadFilename(file.name, "upload.mp3"));
      form.append("durationSeconds", String(durationSeconds));

      const res = await fetch("/api/library/music", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Upload failed.");

      await load();
      setTab("music");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadingMusic(false);
    }
  };

  const deleteMusic = async (id: string, name: string) => {
    if (!window.confirm(`Delete “${name}” from your music library?`)) return;
    setDeletingMusicId(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/library/music?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not delete track.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete track.");
    } finally {
      setDeletingMusicId(null);
    }
  };

  const deleteMotion = async (id: string, name: string) => {
    if (!window.confirm(`Delete “${name}” from your motion library?`)) return;
    setDeletingMotionId(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/library/motions?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not delete motion.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete motion.");
    } finally {
      setDeletingMotionId(null);
    }
  };

  const deleteDemo = async (id: string, name: string) => {
    if (
      !window.confirm(
        `Delete “${name}”?\n\nFinished exports that already used this demo are kept.`,
      )
    ) {
      return;
    }
    setDeletingDemoId(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/library/demos?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not delete demo.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete demo.");
    } finally {
      setDeletingDemoId(null);
    }
  };

  const toggleExportSelection = (exportId: string) => {
    setSelectedExportIds((current) =>
      current.includes(exportId)
        ? current.filter((id) => id !== exportId)
        : [...current, exportId],
    );
  };

  const selectAllExports = () => {
    setSelectedExportIds(exports.map((exp) => exp.id));
  };

  const clearExportSelection = () => {
    setSelectedExportIds([]);
  };

  const selectFirstExports = (count: number) => {
    setSelectedExportIds(exports.slice(0, count).map((exp) => exp.id));
  };

  const downloadExports = async (batch: LibraryExport[]) => {
    if (!batch.length) return;

    setBulkDownloading(true);
    setBulkDownloadProgress(null);
    setError(null);

    try {
      await downloadMediaBulk(
        batch.map((exp) => ({
          id: exp.id,
          url: exp.url,
          filename: exportDownloadFilename(exp),
        })),
        { onProgress: setBulkDownloadProgress },
      );

      for (const exp of batch) {
        markExportDownloaded(exp.id);
      }
      setDownloadCounts(getDownloadCounts());
      setSelectedExportIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk download failed.");
    } finally {
      setBulkDownloading(false);
      setBulkDownloadProgress(null);
    }
  };

  const downloadSelectedExports = async () => {
    const selected = exports.filter((exp) => selectedExportIds.includes(exp.id));
    await downloadExports(selected);
  };

  const downloadFirstExports = async (count: number) => {
    await downloadExports(exports.slice(0, count));
  };

  const deleteExport = async (id: string, name: string) => {
    if (
      !window.confirm(
        `Delete “${name}”?\n\nThis removes the video file and cancels any Instagram schedules for it.`,
      )
    ) {
      return;
    }
    setDeletingExportId(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/library/exports?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not delete export.");
      setSelectedExportIds((current) => current.filter((item) => item !== id));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete export.");
    } finally {
      setDeletingExportId(null);
    }
  };

  const deleteHook = async (id: string, label: string) => {
    if (
      !window.confirm(
        `Delete this hook?\n\n“${label}”\n\nFinished exports that already used it are kept.`,
      )
    ) {
      return;
    }
    setDeletingHookId(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/library/hooks?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not delete hook.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete hook.");
    } finally {
      setDeletingHookId(null);
    }
  };

  const campaignHooks =
    data?.hooks.filter(
      (h) => h.campaignId === activeCampaign?.id && isCompleteHook(h),
    ) ?? [];

  const counts = {
    hooks: campaignHooks.length,
    demos: data?.demos.length ?? 0,
    exports: exports.length,
    motions: data?.motions?.length ?? 0,
    music: data?.music.length ?? 0,
    captions: captionCount,
  };

  const visibleTabs = showCaptionsTab
    ? TABS
    : TABS.filter((t) => t.id !== "captions");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-accent">
          Your media
        </p>
        <h2 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Library
        </h2>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Hooks, demos, finished exports, motions, music, and captions. Use
          Produce to batch-export hook + demo combos, then schedule on
          Instagram.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {visibleTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
              tab === id
                ? "bg-accent text-accent-fg"
                : "border border-border bg-surface-raised text-muted hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                tab === id ? "bg-accent-fg/15" : "bg-surface-hover",
              )}
            >
              {counts[id]}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading library…
        </div>
      ) : tab === "hooks" ? (
        <div className="space-y-4">
          {activeCampaign ? (
            <p className="text-xs text-muted">
              Showing hooks for{" "}
              <span className="font-medium text-foreground">
                {activeCampaign.name}
              </span>
              . Hooks from other campaigns are hidden unless copied here.
            </p>
          ) : (
            <p className="rounded-xl border border-border-subtle bg-surface-raised/40 px-4 py-3 text-xs text-muted">
              Select a campaign to view and upload hooks.{" "}
              <a href="/campaigns" className="text-accent hover:underline">
                Choose campaign →
              </a>
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              ref={hookFileRef}
              type="file"
              accept="video/mp4,video/quicktime,video/*"
              className="hidden"
              onChange={(e) => {
                void handleHookUpload(e.target.files?.[0]);
                e.currentTarget.value = "";
              }}
            />
            <UploadTabButton
              label="Upload hook"
              icon={Sparkles}
              loading={uploadingHook}
              onClick={() => hookFileRef.current?.click()}
            />
          </div>

          {campaignHooks.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {campaignHooks.map((hook) => (
              <li
                key={hook.id}
                className="overflow-hidden rounded-2xl border border-border bg-surface/70"
              >
                <ReelPlayer
                  key={`${hook.id}-${hook.overlayBurned ? "burned" : "raw"}`}
                  size="sm"
                  src={`${hook.url}?v=${hook.overlayBurned ? "1" : "0"}`}
                  controls
                  playsInline
                  preload="metadata"
                />
                <div className="space-y-2 p-4">
                  <p className="line-clamp-2 text-sm font-medium">
                    {hook.actionPrompt || "AI hook clip"}
                  </p>
                  {hook.overlayText && (
                    <p className="text-xs text-accent">
                      Overlay: “{hook.overlayText}”
                    </p>
                  )}
                  {hookCopyLabel(hook, campaigns) ? (
                    <p className="text-[11px] font-medium text-accent">
                      {hookCopyLabel(hook, campaigns)}
                    </p>
                  ) : null}
                  <p className="text-[11px] text-muted">
                    {hook.durationSeconds}s · {formatDate(hook.createdAt)}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <DownloadButton
                      url={hook.url}
                      filename={`${hook.id}.mp4`}
                    />
                    {hook.rawUrl && hook.rawUrl !== hook.url && (
                      <button
                        type="button"
                        disabled={savingMotionHookId === hook.id}
                        onClick={() => void saveHookAsMotion(hook.id)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline disabled:opacity-50"
                      >
                        {savingMotionHookId === hook.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Clapperboard className="h-3.5 w-3.5" />
                        )}
                        Save motion
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={deletingHookId === hook.id}
                      onClick={() =>
                        void deleteHook(
                          hook.id,
                          hook.overlayText ||
                            hook.actionPrompt ||
                            "AI hook clip",
                        )
                      }
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-danger disabled:opacity-50"
                    >
                      {deletingHookId === hook.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Sparkles}
            title="No hooks yet"
            hint="Generate a hook in Create, or upload a finished clip with overlay already burned in."
          />
        )}
        </div>
      ) : tab === "demos" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/quicktime,video/*"
              className="hidden"
              onChange={(e) => {
                void handleDemoUpload(e.target.files?.[0]);
                e.currentTarget.value = "";
              }}
            />
            <UploadTabButton
              label="Upload demo"
              icon={Upload}
              loading={uploading}
              onClick={() => fileRef.current?.click()}
            />
          </div>
          {demoUploadNote ? (
            <p className="text-sm text-muted">{demoUploadNote}</p>
          ) : null}

          {data?.demos.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.demos.map((demo) => (
              <li
                key={demo.id}
                className="overflow-hidden rounded-2xl border border-border bg-surface/70"
              >
                <MediaPlayer
                  src={demo.url}
                  controls
                  playsInline
                  preload="metadata"
                />
                <div className="space-y-2 p-4">
                  <p className="truncate text-sm font-medium">{demo.name}</p>
                  <p className="text-[11px] text-muted">
                    {demo.durationSeconds}s · {formatDate(demo.uploadedAt)}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <DownloadButton
                      url={demo.url}
                      filename={`${demo.id}.mp4`}
                    />
                    <button
                      type="button"
                      disabled={deletingDemoId === demo.id}
                      onClick={() => void deleteDemo(demo.id, demo.name)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-danger disabled:opacity-50"
                    >
                      {deletingDemoId === demo.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Upload}
            title="No demo clips yet"
            hint="Upload product recordings with the button above."
          />
        )}
        </div>
      ) : tab === "motions" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              ref={motionFileRef}
              type="file"
              accept="video/mp4,video/quicktime,video/*"
              className="hidden"
              onChange={(e) => {
                void handleMotionUpload(e.target.files?.[0]);
                e.currentTarget.value = "";
              }}
            />
            <UploadTabButton
              label="Upload motion"
              icon={Clapperboard}
              loading={uploadingMotion}
              onClick={() => motionFileRef.current?.click()}
            />
          </div>

          {data?.motions?.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.motions.map((motion) => (
              <li
                key={motion.id}
                className="overflow-hidden rounded-2xl border border-border bg-surface/70"
              >
                <ReelPlayer
                  size="sm"
                  src={motion.url}
                  controls
                  playsInline
                  preload="metadata"
                />
                <div className="space-y-2 p-4">
                  <p className="line-clamp-2 text-sm font-medium">{motion.name}</p>
                  {motion.actionPrompt ? (
                    <p className="line-clamp-2 text-xs text-muted">
                      {motion.actionPrompt}
                    </p>
                  ) : null}
                  <p className="text-[11px] text-muted">
                    {motion.durationSeconds}s · {formatDate(motion.uploadedAt)}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <DownloadButton
                      url={motion.url}
                      filename={`${motion.id}.mp4`}
                    />
                    <button
                      type="button"
                      disabled={deletingMotionId === motion.id}
                      onClick={() => void deleteMotion(motion.id, motion.name)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-danger disabled:opacity-50"
                    >
                      {deletingMotionId === motion.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Clapperboard}
            title="No motion clips yet"
            hint="Upload a reference hook clip here, or save motion from an existing hook."
          />
        )}
        </div>
      ) : tab === "music" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              ref={musicFileRef}
              type="file"
              accept="audio/mpeg,audio/mp4,audio/wav,audio/*"
              className="hidden"
              onChange={(e) => {
                void handleMusicUpload(e.target.files?.[0]);
                e.currentTarget.value = "";
              }}
            />
            <UploadTabButton
              label="Upload music"
              icon={Music2}
              loading={uploadingMusic}
              onClick={() => musicFileRef.current?.click()}
            />
          </div>

          {data?.music.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.music.map((track) => (
              <li
                key={track.id}
                className="overflow-hidden rounded-2xl border border-border bg-surface/70"
              >
                <div className="flex items-center gap-3 border-b border-border bg-surface-raised px-4 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
                    <Music2 className="h-5 w-5" />
                  </div>
                  <audio
                    src={track.url}
                    controls
                    preload="metadata"
                    className="min-w-0 flex-1"
                  />
                </div>
                <div className="space-y-2 p-4">
                  <p className="truncate text-sm font-medium">{track.name}</p>
                  <p className="text-[11px] text-muted">
                    {track.durationSeconds ? `${track.durationSeconds}s · ` : ""}
                    {formatDate(track.uploadedAt)}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <DownloadButton
                      url={track.url}
                      filename={`${track.id}.mp3`}
                    />
                    <button
                      type="button"
                      disabled={deletingMusicId === track.id}
                      onClick={() => void deleteMusic(track.id, track.name)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-danger disabled:opacity-50"
                    >
                      {deletingMusicId === track.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Music2}
            title="No background tracks yet"
            hint="Upload MP3, M4A, or WAV files with the button above. Use royalty-free music you have rights to."
          />
        )}
        </div>
      ) : tab === "captions" ? (
        <CaptionLibraryPanel
          onChange={(captions) => setCaptionCount(captions.length)}
        />
      ) : tab === "exports" ? (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Finished hook + demo videos from Produce. Schedule them on the{" "}
            <a href="/instagram" className="text-accent hover:underline">
              Instagram
            </a>{" "}
            page.
          </p>
          {exports.length ? (
            <>
              <div className="space-y-2 rounded-xl border border-border bg-surface-raised/60 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllExports}
                      disabled={bulkDownloading}
                      className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
                    >
                      Select all ({exports.length})
                    </button>
                    {selectedExportIds.length ? (
                      <>
                        <span className="text-xs text-muted">·</span>
                        <button
                          type="button"
                          onClick={clearExportSelection}
                          disabled={bulkDownloading}
                          className="text-xs font-medium text-muted hover:text-foreground disabled:opacity-50"
                        >
                          Clear
                        </button>
                      </>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={bulkDownloading || !selectedExportIds.length}
                    onClick={() => void downloadSelectedExports()}
                    className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-accent-fg disabled:opacity-50"
                  >
                    {bulkDownloading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Download selected
                    {selectedExportIds.length ? ` (${selectedExportIds.length})` : ""}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
                    Quick batches
                  </span>
                  {EXPORT_BATCH_SIZES.map((size) => {
                    const available = Math.min(size, exports.length);
                    if (!available) return null;
                    return (
                      <div key={size} className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={bulkDownloading}
                          onClick={() => selectFirstExports(available)}
                          className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-50"
                        >
                          Select {available}
                        </button>
                        <button
                          type="button"
                          disabled={bulkDownloading}
                          onClick={() => void downloadFirstExports(available)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs font-medium hover:border-accent disabled:opacity-50"
                        >
                          <Download className="h-3 w-3" />
                          Download {available}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
              {bulkDownloadProgress ? (
                <p className="text-xs text-muted">
                  {bulkDownloadProgress.phase === "packaging"
                    ? `Packaging ${bulkDownloadProgress.total} videos into ${bulkDownloadProgress.folderName}…`
                    : `Downloading ${bulkDownloadProgress.folderName}.zip…`}
                </p>
              ) : null}
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {exports.map((exp) => {
                  const selected = selectedExportIds.includes(exp.id);
                  const downloadCount = downloadCounts[exp.id] ?? 0;

                  return (
                    <li
                      key={exp.id}
                      className={cn(
                        "overflow-hidden rounded-2xl border bg-surface/70",
                        selected
                          ? "border-accent ring-1 ring-accent/30"
                          : "border-border",
                      )}
                    >
                      <div className="relative">
                        <label className="absolute left-3 top-3 z-10 flex cursor-pointer items-center gap-2 rounded-lg bg-black/55 px-2 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={bulkDownloading}
                            onChange={() => toggleExportSelection(exp.id)}
                            className="accent-accent"
                          />
                          Select
                        </label>
                        <ReelPlayer
                          size="sm"
                          src={exp.url}
                          controls
                          playsInline
                          preload="metadata"
                        />
                      </div>
                      <div className="space-y-2 p-4">
                        <p className="line-clamp-2 text-sm font-medium">{exp.name}</p>
                        <p className="text-[11px] text-muted">
                          {formatDate(exp.createdAt)}
                          {exp.runFolder ? ` · ${exp.runFolder}` : ""}
                          {downloadCount > 0
                            ? ` · Downloaded ${downloadCount}×`
                            : ""}
                        </p>
                        <div className="flex flex-wrap items-center gap-3">
                          <DownloadButton
                            url={exp.url}
                            filename={exportDownloadFilename(exp)}
                            trackingId={exp.id}
                            downloadCount={downloadCount}
                            onDownloaded={(id, count) => {
                              setDownloadCounts((current) => ({
                                ...current,
                                [id]: count,
                              }));
                            }}
                          />
                          <button
                            type="button"
                            disabled={deletingExportId === exp.id || bulkDownloading}
                            onClick={() => void deleteExport(exp.id, exp.name)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-danger disabled:opacity-50"
                          >
                            {deletingExportId === exp.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            Delete
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <EmptyState
              icon={Share2}
              title="No finished exports yet"
              hint="Go to Produce to batch-export hook + demo videos for this campaign."
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
