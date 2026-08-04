"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Save, Trash2, Upload } from "lucide-react";
import type {
  Campaign,
  CampaignAudioMode,
  CampaignStatus,
  LibraryCaption,
  LibraryData,
  LibraryMusic,
} from "@/lib/types";
import { isCampaignClosed } from "@/lib/campaign-status";
import { hooksOwnedByCampaign, hookCopyLabel } from "@/lib/campaign-hooks";
import {
  availableCampaignMusicTracks,
  ownCampaignMusicTracks,
  resolveMusicBorrowSource,
} from "@/lib/campaign-music";
import { isCompleteHook, cn } from "@/lib/utils";
import { DEFAULT_MUSIC_VOLUME } from "@/lib/constants";

export function CampaignSettings() {
  const router = useRouter();
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [captions, setCaptions] = useState<LibraryCaption[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [hookIds, setHookIds] = useState<string[]>([]);
  const [demoIds, setDemoIds] = useState<string[]>([]);
  const [captionIds, setCaptionIds] = useState<string[]>([]);
  const [useCaptions, setUseCaptions] = useState(false);
  const [audioMode, setAudioMode] = useState<CampaignAudioMode>("none");
  const [musicId, setMusicId] = useState<string | null>(null);
  const [musicVolume, setMusicVolume] = useState(DEFAULT_MUSIC_VOLUME);
  const [randomFormat, setRandomFormat] = useState(true);
  const [borrowMusicFromCampaignId, setBorrowMusicFromCampaignId] = useState<
    string | null
  >(null);
  const [status, setStatus] = useState<CampaignStatus>("open");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [deletingMusicId, setDeletingMusicId] = useState<string | null>(null);

  const applyCampaign = useCallback((c: Campaign) => {
    setCampaign(c);
    setHookIds([...c.hookIds]);
    setDemoIds([...c.demoIds]);
    setCaptionIds([...c.captionIds]);
    setUseCaptions(c.useCaptions);
    setAudioMode(c.audioMode);
    setMusicId(c.musicId);
    setMusicVolume(c.musicVolume);
    setRandomFormat(c.randomFormat);
    setBorrowMusicFromCampaignId(c.borrowMusicFromCampaignId ?? null);
    setStatus(c.status ?? "open");
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [libRes, capRes, campRes] = await Promise.all([
        fetch("/api/library?scope=pickers"),
        fetch("/api/library/captions"),
        fetch("/api/campaigns"),
      ]);
      const lib = (await libRes.json()) as LibraryData;
      if (!libRes.ok) {
        throw new Error("Could not load library assets.");
      }
      setLibrary(lib);
      const capJson = (await capRes.json()) as {
        captions?: LibraryCaption[];
        error?: string;
      };
      if (!capRes.ok) {
        throw new Error(capJson.error || "Could not load captions.");
      }
      setCaptions(capJson.captions ?? []);
      const campJson = (await campRes.json()) as {
        campaigns?: Campaign[];
        activeId?: string | null;
        error?: string;
      };
      if (!campRes.ok) {
        throw new Error(campJson.error || "Could not load campaigns.");
      }
      const list = campJson.campaigns ?? [];
      setCampaigns(list);
      const active = campJson.activeId
        ? list.find((c) => c.id === campJson.activeId) ?? null
        : null;
      if (active) {
        applyCampaign(active);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load campaign settings.",
      );
    } finally {
      setLoading(false);
    }
  }, [applyCampaign]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string, list: string[], set: (v: string[]) => void) => {
    setSaved(false);
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const campaignForMusic = campaign
    ? { ...campaign, borrowMusicFromCampaignId }
    : null;
  const ownMusic = campaign
    ? ownCampaignMusicTracks(library?.music ?? [], campaign.id)
    : [];
  const musicBorrowSource = campaignForMusic
    ? resolveMusicBorrowSource(campaignForMusic, campaigns)
    : null;
  const borrowedMusic =
    campaignForMusic && musicBorrowSource
      ? ownCampaignMusicTracks(library?.music ?? [], musicBorrowSource.id)
      : [];
  const availableMusic =
    campaignForMusic && library
      ? availableCampaignMusicTracks(campaignForMusic, library.music, campaigns)
      : [];
  const otherCampaigns = campaigns.filter((c) => c.id !== campaign?.id);

  const handleCampaignMusicUpload = async (file: File | undefined) => {
    if (!file || !campaign) return;
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
      form.append("file", file);
      form.append("durationSeconds", String(durationSeconds));
      form.append("campaignId", campaign.id);

      const res = await fetch("/api/library/music", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as LibraryMusic & { error?: string };
      if (!res.ok) throw new Error(json.error || "Upload failed.");

      setLibrary((prev) =>
        prev
          ? { ...prev, music: [json, ...prev.music] }
          : {
              hooks: [],
              demos: [],
              motions: [],
              music: [json],
              characters: [],
              exports: [],
            },
      );
      setSaved(false);
      setMusicId(json.id);
      await save({
        musicId: json.id,
        audioMode: audioMode === "none" ? "fixed" : audioMode,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadingMusic(false);
    }
  };

  const deleteCampaignMusic = async (id: string, name: string) => {
    if (!window.confirm(`Delete “${name}” from this campaign?`)) return;
    setDeletingMusicId(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/library/music?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not delete track.");

      setLibrary((prev) =>
        prev
          ? { ...prev, music: prev.music.filter((track) => track.id !== id) }
          : prev,
      );
      if (musicId === id) {
        setMusicId(null);
      }
      setSaved(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete track.");
    } finally {
      setDeletingMusicId(null);
    }
  };

  const save = async (overrides?: {
    audioMode?: CampaignAudioMode;
    musicId?: string | null;
    borrowMusicFromCampaignId?: string | null;
  }) => {
    if (!campaign) return false;
    const nextAudioMode = overrides?.audioMode ?? audioMode;
    const nextMusicId =
      overrides?.musicId !== undefined ? overrides.musicId : musicId;
    const nextBorrowMusicFromCampaignId =
      overrides?.borrowMusicFromCampaignId !== undefined
        ? overrides.borrowMusicFromCampaignId
        : borrowMusicFromCampaignId;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hookIds,
          demoIds,
          captionIds: useCaptions ? captionIds : [],
          useCaptions,
          audioMode: nextAudioMode,
          musicId: nextAudioMode === "none" ? null : nextMusicId,
          musicVolume,
          randomFormat,
          borrowMusicFromCampaignId: nextBorrowMusicFromCampaignId,
          status,
        }),
      });
      const json = (await res.json()) as Campaign & { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not save settings.");
      applyCampaign(json);
      setSaved(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const deleteCampaign = async () => {
    if (!campaign) return;
    if (
      !window.confirm(
        `Delete “${campaign.name}”? This cannot be undone. Your library assets and exports are kept.`,
      )
    ) {
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/campaigns?id=${encodeURIComponent(campaign.id)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not delete campaign.");
      router.push("/campaigns");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete campaign.");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="rounded-2xl border border-border-subtle p-8 text-center">
        <p className="font-medium">No active campaign</p>
        <Link href="/campaigns" className="mt-2 inline-block text-sm text-accent hover:underline">
          Select or create a campaign →
        </Link>
      </div>
    );
  }

  const ownedHooks =
    library && campaign
      ? hooksOwnedByCampaign(campaign.id, library).filter(isCompleteHook)
      : [];
  const campaignDemos = (library?.demos ?? []).filter((demo) =>
    demoIds.includes(demo.id),
  );
  const allDemos = library?.demos ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-accent">
            {campaign.name}
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold">
            Campaign setup
          </h2>
          <p className="mt-1 text-sm text-muted">
            Choose which assets and audio to use when producing videos for this
            campaign.
          </p>
          {campaign.copiedFromCampaignId ? (
            <p className="mt-2 text-xs text-muted">
              Duplicated from{" "}
              {campaigns.find((c) => c.id === campaign.copiedFromCampaignId)?.name ??
                "another campaign"}
              .
            </p>
          ) : null}
        </div>
        <Link
          href="/campaigns"
          className="text-sm text-accent hover:underline"
        >
          Switch campaign
        </Link>
      </div>

      <div className="rounded-xl border border-border-subtle bg-surface-raised/40 p-4">
        <p className="text-sm font-medium">Campaign status</p>
        <p className="mt-1 text-xs text-muted">
          Closed campaigns are read-only for production — reopen when you want
          to export videos or add hooks again.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ["open", "Open"],
              ["closed", "Closed"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={cn(
                "cursor-pointer rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
                status === value
                  ? value === "closed"
                    ? "border-muted bg-surface-raised text-foreground"
                    : "border-accent/50 bg-accent/10 text-accent"
                  : "border-border-subtle text-muted hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name="campaignStatus"
                checked={status === value}
                onChange={() => {
                  setSaved(false);
                  setStatus(value);
                }}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
        {isCampaignClosed({ status }) ? (
          <p className="mt-2 text-xs text-muted">
            This campaign is closed. Save to apply — Produce and new hooks are
            disabled until you set it back to Open.
          </p>
        ) : null}
      </div>

      <AssetPicker
        title="Hooks"
        emptyHint={
          <>
            No hooks for this campaign yet.{" "}
            <Link href="/create" className="text-accent hover:underline">
              Generate
            </Link>{" "}
            with a text overlay or{" "}
            <Link href="/library" className="text-accent hover:underline">
              upload in Library
            </Link>
            .
          </>
        }
        items={ownedHooks.map((h) => ({
          id: h.id,
          label: h.overlayText || h.actionPrompt || h.id,
          badge: hookCopyLabel(h, campaigns) ?? undefined,
        }))}
        selected={hookIds}
        onToggle={(id) => toggle(id, hookIds, setHookIds)}
        onSelectAll={setHookIds}
      />

      <AssetPicker
        title="Demos"
        emptyHint={
          <>
            No demos selected for this campaign yet.{" "}
            <Link href="/library?tab=demos" className="text-accent hover:underline">
              Upload in Library
            </Link>{" "}
            or select from your uploaded demos below.
          </>
        }
        items={allDemos.map((d) => ({
          id: d.id,
          label: d.name,
        }))}
        selected={demoIds}
        onToggle={(id) => toggle(id, demoIds, setDemoIds)}
        onSelectAll={setDemoIds}
      />
      {demoIds.length > 0 && campaignDemos.length !== demoIds.length ? (
        <p className="text-xs text-muted">
          Some selected demos are missing from the library and will be ignored
          until re-uploaded.
        </p>
      ) : null}

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useCaptions}
            onChange={(e) => {
              setSaved(false);
              setUseCaptions(e.target.checked);
            }}
          />
          Burn captions from library
        </label>
        {useCaptions && (
          <AssetPicker
            title="Captions"
            emptyHint={
              <>
                Add captions in{" "}
                <Link href="/library" className="text-accent hover:underline">
                  Library → Captions
                </Link>
                .
              </>
            }
            items={captions.map((c) => ({ id: c.id, label: c.text }))}
            selected={captionIds}
            onToggle={(id) => toggle(id, captionIds, setCaptionIds)}
            onSelectAll={setCaptionIds}
          />
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={randomFormat}
            onChange={(e) => {
              setSaved(false);
              setRandomFormat(e.target.checked);
            }}
            disabled={!useCaptions}
          />
          Random caption format per video
        </label>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium text-muted">Audio</p>
        {(
          [
            ["none", "No sound (add trending audio in Instagram)"],
            ["random", "Random track from campaign library"],
            ["fixed", "Fixed music track"],
          ] as const
        ).map(([mode, label]) => (
          <label key={mode} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="audioMode"
              checked={audioMode === mode}
              onChange={() => {
                setSaved(false);
                setAudioMode(mode);
                if (mode === "none") {
                  setMusicId(null);
                } else if (mode === "fixed") {
                  setMusicId((current) =>
                    current && availableMusic.some((track) => track.id === current)
                      ? current
                      : null,
                  );
                }
              }}
            />
            {label}
          </label>
        ))}
        {audioMode === "fixed" && (
          <select
            value={musicId ?? ""}
            onChange={(e) => {
              setSaved(false);
              setMusicId(e.target.value || null);
            }}
            className="w-full rounded-xl border border-border-subtle bg-background px-3 py-2 text-sm"
          >
            <option value="">Select track</option>
            {availableMusic.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {borrowedMusic.some((track) => track.id === m.id)
                  ? ` (${musicBorrowSource?.name ?? "borrowed"})`
                  : ""}
              </option>
            ))}
          </select>
        )}
        {audioMode !== "none" && (
          <div>
            <label className="mb-1 block text-xs text-muted">
              Volume ({musicVolume}%)
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={musicVolume}
              onChange={(e) => {
                setSaved(false);
                setMusicVolume(Number(e.target.value));
              }}
              className="w-full"
            />
          </div>
        )}
      </div>

      {campaign && (
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted">Campaign music library</p>
          <p className="text-xs text-muted">
            Each campaign starts with an empty library. Upload tracks here or
            reuse music from another campaign.
          </p>
          <div className="space-y-3 rounded-xl border border-border-subtle bg-background/40 p-3">
            <div>
              <label className="mb-1 block text-xs text-muted">
                Reuse music from
              </label>
              <select
                value={borrowMusicFromCampaignId ?? ""}
                onChange={(e) => {
                  const nextId = e.target.value || null;
                  setSaved(false);
                  setBorrowMusicFromCampaignId(nextId);
                  setMusicId((current) =>
                    current &&
                    availableCampaignMusicTracks(
                      { ...campaign, borrowMusicFromCampaignId: nextId },
                      library?.music ?? [],
                      campaigns,
                    ).some((track) => track.id === current)
                      ? current
                      : null,
                  );
                }}
                className="w-full rounded-xl border border-border-subtle bg-background px-3 py-2 text-sm"
              >
                <option value="">None (this campaign only)</option>
                {otherCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm hover:bg-surface-hover">
              <Upload className="h-4 w-4" />
              {uploadingMusic ? "Uploading…" : "Upload track"}
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                disabled={uploadingMusic}
                onChange={(e) => {
                  void handleCampaignMusicUpload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {ownMusic.length > 0 ? (
              <ul className="space-y-1">
                {ownMusic.map((track) => (
                  <li
                    key={track.id}
                    className="flex items-center justify-between gap-2 text-xs text-muted"
                  >
                    <span className="truncate">{track.name}</span>
                    <button
                      type="button"
                      disabled={deletingMusicId === track.id}
                      onClick={() => void deleteCampaignMusic(track.id, track.name)}
                      className="shrink-0 rounded p-1 text-muted hover:text-red-400 disabled:opacity-50"
                      aria-label={`Delete ${track.name}`}
                    >
                      {deletingMusicId === track.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">No tracks uploaded yet.</p>
            )}
            {borrowedMusic.length > 0 && musicBorrowSource && (
              <div className="space-y-1 border-t border-border-subtle pt-3">
                <p className="text-xs text-muted">
                  Borrowed from {musicBorrowSource.name}
                </p>
                <ul className="space-y-1">
                  {borrowedMusic.map((track) => (
                    <li key={track.id} className="truncate text-xs text-muted">
                      {track.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-accent-fg disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save settings
        </button>
        {saved && (
          <span className="text-sm text-muted">Saved</span>
        )}
        <Link
          href="/produce"
          className="rounded-xl border border-border-subtle px-4 py-2.5 text-sm hover:bg-surface-hover"
        >
          Go to Produce →
        </Link>
      </div>

      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
        <p className="text-sm font-medium text-red-300">Delete campaign</p>
        <p className="mt-1 text-xs text-muted">
          Remove this campaign permanently. Hooks, demos, and exports in your
          library are not deleted.
        </p>
        <button
          type="button"
          disabled={deleting || saving}
          onClick={() => void deleteCampaign()}
          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Delete “{campaign.name}”
        </button>
      </div>
    </div>
  );
}

function AssetPicker({
  title,
  emptyHint,
  items,
  selected,
  onToggle,
  onSelectAll,
  disabled = false,
  disabledHint,
}: {
  title: string;
  emptyHint: React.ReactNode;
  items: Array<{ id: string; label: string; badge?: string }>;
  selected: string[];
  onToggle: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">
        <p className="font-medium text-foreground/80">{title}</p>
        <p className="mt-1 text-xs">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{title}</p>
        {!disabled ? (
          <button
            type="button"
            onClick={() =>
              onSelectAll(
                selected.length === items.length ? [] : items.map((i) => i.id),
              )
            }
            className="text-xs text-accent hover:underline"
          >
            {selected.length === items.length ? "Clear all" : "Select all"}
          </button>
        ) : null}
      </div>
      {disabled && disabledHint ? (
        <p className="mb-2 text-xs text-muted">{disabledHint}</p>
      ) : null}
      <ul
        className={cn(
          "max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border-subtle bg-background/50 p-2",
          disabled && "opacity-60",
        )}
      >
        {items.map((item) => (
          <li key={item.id}>
            <label
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                disabled ? "cursor-default" : "cursor-pointer hover:bg-surface-hover",
              )}
            >
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                disabled={disabled}
                onChange={() => onToggle(item.id)}
              />
              <span className="min-w-0 truncate">
                <span className="truncate">{item.label}</span>
                {item.badge ? (
                  <span className="mt-0.5 block truncate text-[11px] text-accent">
                    {item.badge}
                  </span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
