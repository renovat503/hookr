"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FolderOpen, Loader2, Play } from "lucide-react";
import { buildLibraryExportRequest } from "@/lib/capture-caption";
import { DEFAULT_OVERLAY_STYLE } from "@/lib/constants";
import { loadFormatPresets } from "@/lib/format-presets";
import type { Campaign, LibraryData } from "@/lib/types";
import type { ProduceCombo } from "@/lib/produce-combos";
import { mergeCampaignAssets, resolveBorrowSource } from "@/lib/campaign-assets";
import { hooksOwnedByCampaign } from "@/lib/campaign-hooks";
import { isCampaignClosed } from "@/lib/campaign-status";
import { cn, isCompleteHook } from "@/lib/utils";

function formatRunFolder(campaignId: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${campaignId.slice(-6)}`;
}

function idsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}

export function ProduceRunner() {
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [maxCount, setMaxCount] = useState<number | "all">("all");
  const [plannedCombos, setPlannedCombos] = useState<ProduceCombo[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, label: "" });
  const [lastRunFolder, setLastRunFolder] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    created: number;
    failed: number;
    skipped: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [planReady, setPlanReady] = useState(false);
  const cancelRef = useRef(false);
  const planRequestRef = useRef(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [libRes, campRes] = await Promise.all([
        fetch("/api/library?scope=pickers"),
        fetch("/api/campaigns"),
      ]);
      const lib = (await libRes.json()) as LibraryData & { error?: string };
      const campJson = (await campRes.json()) as {
        campaigns?: Campaign[];
        activeId?: string | null;
        error?: string;
      };
      if (!libRes.ok) throw new Error(lib.error || "Could not load library.");
      if (!campRes.ok) {
        throw new Error(campJson.error || "Could not load campaigns.");
      }
      setLibrary(lib);
      setCampaigns(campJson.campaigns ?? []);
      const active = campJson.activeId
        ? campJson.campaigns?.find((c) => c.id === campJson.activeId) ?? null
        : null;
      setCampaign(active);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load produce page.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mergedAssets = useMemo(() => {
    if (!campaign || !library) return null;
    return mergeCampaignAssets(campaign, library, campaigns);
  }, [campaign, library, campaigns]);

  const libraryHookCount =
    campaign && library
      ? hooksOwnedByCampaign(campaign.id, library).filter(isCompleteHook).length
      : 0;

  const planKey = useMemo(() => {
    if (!campaign || !mergedAssets) return null;
    return JSON.stringify({
      campaignId: campaign.id,
      hookIds: mergedAssets.hookIds,
      demoIds: mergedAssets.demoIds,
      useCaptions: campaign.useCaptions,
      captionIds: campaign.captionIds,
      maxCount,
    });
  }, [campaign, mergedAssets, maxCount]);

  const planRun = useCallback(async () => {
    if (!library || !campaign || !mergedAssets) return;

    const requestId = ++planRequestRef.current;
    setPlanning(true);
    setError(null);
    setSummary(null);

    try {
      const res = await fetch("/api/produce/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaign.id,
          hookIds: mergedAssets.hookIds,
          demoIds: mergedAssets.demoIds,
          captionIds: campaign.useCaptions ? campaign.captionIds : [],
          noCaptions: !campaign.useCaptions,
          shuffle: true,
          maxCount: maxCount === "all" ? undefined : maxCount,
        }),
      });
      const json = (await res.json()) as {
        combos: ProduceCombo[];
        total: number;
        campaign?: Campaign;
        error?: string;
      };
      if (requestId !== planRequestRef.current) return;
      if (!res.ok) throw new Error(json.error || "Could not plan run.");

      if (json.campaign) {
        setCampaign((prev) => {
          if (!prev || prev.id !== json.campaign!.id) return json.campaign!;
          if (
            idsEqual(prev.hookIds, json.campaign!.hookIds) &&
            idsEqual(prev.demoIds, json.campaign!.demoIds)
          ) {
            return prev;
          }
          return json.campaign!;
        });
      }

      setPlannedCombos(json.combos);
      setPlanReady(true);
    } catch (err) {
      if (requestId !== planRequestRef.current) return;
      setError(err instanceof Error ? err.message : "Could not plan run.");
    } finally {
      if (requestId === planRequestRef.current) {
        setPlanning(false);
      }
    }
  }, [library, campaign, mergedAssets, maxCount]);

  useEffect(() => {
    if (!planKey) {
      setPlannedCombos([]);
      setPlanReady(false);
      return;
    }
    void planRun();
  }, [planKey, planRun]);

  const exportEstimate = plannedCombos.length;
  const hookCount = mergedAssets?.hookIds.length ?? 0;
  const demoCount = mergedAssets?.demoIds.length ?? 0;
  const maxComboEstimate = hookCount * demoCount;
  const campaignClosed = campaign ? isCampaignClosed(campaign) : false;

  const canRun = useMemo(
    () =>
      Boolean(
        campaign &&
          library &&
          !campaignClosed &&
          planReady &&
          hookCount > 0 &&
          demoCount > 0 &&
          exportEstimate > 0 &&
          !planning &&
          (campaign.audioMode !== "random" ||
            (library.music.length ?? 0) > 0) &&
          (campaign.audioMode !== "fixed" || campaign.musicId),
      ),
    [campaign, library, campaignClosed, planReady, hookCount, demoCount, exportEstimate, planning],
  );

  const pickRandomFormat = () => {
    const presets = loadFormatPresets();
    if (!presets.length) return DEFAULT_OVERLAY_STYLE;
    return presets[Math.floor(Math.random() * presets.length)].style;
  };

  const resolveMusicId = (): string | null => {
    if (!campaign || !library) return null;
    if (campaign.audioMode === "none") return null;
    if (campaign.audioMode === "fixed") return campaign.musicId;
    if (!library.music.length) return null;
    return library.music[Math.floor(Math.random() * library.music.length)].id;
  };

  const runProduction = async () => {
    if (!library || !campaign || !plannedCombos.length) return;
    cancelRef.current = false;
    setRunning(true);
    setError(null);
    setSummary(null);

    const runFolder = formatRunFolder(campaign.id);
    setLastRunFolder(runFolder);

    let created = 0;
    let failed = 0;
    let skipped = 0;
    let firstError: string | null = null;

    setProgress({ current: 0, total: plannedCombos.length, label: "" });

    for (let i = 0; i < plannedCombos.length; i++) {
      if (cancelRef.current) break;

      const combo = plannedCombos[i];
      const hook = library.hooks.find((h) => h.id === combo.hookId);
      const demo = library.demos.find((d) => d.id === combo.demoId);
      if (!hook || !demo) {
        skipped += 1;
        continue;
      }

      const musicId = resolveMusicId();

      setProgress({
        current: i + 1,
        total: plannedCombos.length,
        label: combo.overlayText
          ? `${combo.overlayText.slice(0, 32)} + ${demo.name}`
          : `${hook.actionPrompt || "Hook"} + ${demo.name}`,
      });

      try {
        const body = await buildLibraryExportRequest(
          hook,
          combo.demoId,
          combo.overlayText,
          {
            musicId,
            musicVolume: campaign.musicVolume,
            overlayStyle:
              campaign.useCaptions && campaign.randomFormat
                ? pickRandomFormat()
                : undefined,
          },
        );

        const res = await fetch("/api/library/exports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...body,
            runFolder,
            sequence: created + 1,
            campaignId: campaign.id,
          }),
        });
        const json = (await res.json()) as { error?: string };
        if (res.status === 409) {
          skipped += 1;
          continue;
        }
        if (!res.ok) throw new Error(json.error || "Export failed.");
        created += 1;
      } catch (err) {
        failed += 1;
        if (!firstError) {
          firstError =
            err instanceof Error ? err.message : "Export failed.";
        }
      }
    }

    setSummary({ created, failed, skipped });
    if (firstError && failed > 0) {
      setError(
        failed === 1
          ? firstError
          : `${failed} exports failed. First error: ${firstError}`,
      );
    }
    setRunning(false);
    await load();
    void planRun();
  };

  if (loading) {
    return <ProduceSkeleton />;
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

  const borrowSource = resolveBorrowSource(campaign, campaigns);
  const hooksBorrowed =
    campaign.borrowAssetKind === "hooks" && Boolean(borrowSource);
  const demosBorrowed =
    campaign.borrowAssetKind === "demos" && Boolean(borrowSource);

  const needsSetup =
    (campaign.useCaptions && !campaign.captionIds.length) ||
    (campaign.audioMode === "fixed" && !campaign.musicId);

  const missingHooks = !mergedAssets?.hookIds.length;
  const missingDemos = !mergedAssets?.demoIds.length;

  if (needsSetup) {
    return (
      <div className="rounded-2xl border border-border-subtle p-8 text-center">
        <p className="font-display text-lg font-semibold">{campaign.name}</p>
        <p className="mt-2 text-sm text-muted">
          Fix the items below in campaign settings before producing.
        </p>
        <ul className="mx-auto mt-4 max-w-xs space-y-1 text-left text-sm text-muted">
          {campaign.useCaptions && !campaign.captionIds.length && (
            <li>· Captions enabled but none selected</li>
          )}
          {campaign.audioMode === "fixed" && !campaign.musicId && (
            <li>· Fixed audio mode but no track selected</li>
          )}
        </ul>
        <Link
          href="/campaign/settings"
          className="mt-4 inline-block rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg"
        >
          Open campaign settings →
        </Link>
      </div>
    );
  }

  const exportsHint =
    !campaign.useCaptions && maxComboEstimate > 0
      ? `Up to ${maxComboEstimate} (hooks × demos)`
      : "\u00a0";

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {(missingHooks || missingDemos) && !campaignClosed && (
        <div className="rounded-xl border border-border-subtle bg-surface-raised/40 px-4 py-3 text-sm text-muted">
          {missingHooks ? (
            <p>
              {hooksBorrowed && borrowSource
                ? `No hooks available from “${borrowSource.name}” yet.`
                : "No hooks for this campaign yet — that’s fine if you skipped copying them."}{" "}
              <Link href="/create" className="text-accent hover:underline">
                Generate hooks
              </Link>{" "}
              or{" "}
              <Link href="/campaign/settings" className="text-accent hover:underline">
                copy from another campaign
              </Link>{" "}
              when you’re ready. Export stays disabled until hooks are added.
            </p>
          ) : null}
          {missingDemos ? (
            <p className={missingHooks ? "mt-2" : undefined}>
              {demosBorrowed && borrowSource
                ? `No demos available from “${borrowSource.name}” yet.`
                : "No demos selected for this campaign."}{" "}
              <Link href="/campaign/settings" className="text-accent hover:underline">
                Choose demos in settings
              </Link>
              .
            </p>
          ) : null}
        </div>
      )}

      {campaignClosed && (
        <div className="rounded-xl border border-border-subtle bg-surface-raised/40 px-4 py-3 text-sm text-muted">
          This campaign is <span className="font-medium text-foreground">closed</span>.
          Viewing only — reopen in{" "}
          <Link href="/campaign/settings" className="text-accent hover:underline">
            campaign settings
          </Link>{" "}
          to produce or add hooks.
        </div>
      )}

      <section className="rounded-2xl border border-border-subtle bg-surface-raised/40 p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold">{campaign.name}</h2>
            <p className="text-xs text-muted">
              {campaign.audioMode === "none"
                ? "Silent exports"
                : campaign.audioMode === "random"
                  ? "Random music"
                  : "Fixed music track"}{" "}
              ·{" "}
              {campaign.useCaptions
                ? `${campaign.captionIds.length} captions`
                : "No on-video captions"}
            </p>
          </div>
          <Link
            href="/campaign/settings"
            className="shrink-0 text-xs text-accent hover:underline"
          >
            Campaign settings
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat
            label="Hooks"
            value={hookCount}
            hint={
              hooksBorrowed && borrowSource
                ? `From “${borrowSource.name}”`
                : libraryHookCount > hookCount
                  ? `${libraryHookCount} for this campaign`
                  : "\u00a0"
            }
          />
          <Stat
            label="Demos"
            value={demoCount}
            hint={
              demosBorrowed && borrowSource
                ? `From “${borrowSource.name}”`
                : "\u00a0"
            }
          />
          <Stat
            label="Captions"
            value={campaign.useCaptions ? campaign.captionIds.length : "—"}
          />
          <Stat
            label="Unique exports ready"
            value={exportEstimate}
            accent
            loading={planning && !planReady}
            hint={exportsHint}
          />
        </div>

        <div className="mt-4 max-w-xs">
          <label className="mb-1.5 block text-xs font-medium text-muted">
            Max videos this run
          </label>
          <select
            value={maxCount === "all" ? "all" : String(maxCount)}
            disabled={planning || !planReady}
            onChange={(e) =>
              setMaxCount(
                e.target.value === "all" ? "all" : Number(e.target.value),
              )
            }
            className="w-full rounded-xl border border-border-subtle bg-background px-3 py-2 text-sm disabled:opacity-60"
          >
            <option value="all">
              All available ({planReady ? exportEstimate : "…"})
            </option>
            {[10, 25, 50, 100, 200].map((n) => (
              <option key={n} value={n} disabled={!planReady || n > exportEstimate}>
                {n} videos
              </option>
            ))}
          </select>
        </div>

        <div className="mt-6 flex min-h-[42px] flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canRun || running}
            onClick={() => void runProduction()}
            className={cn(
              "inline-flex min-w-[168px] items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {running
              ? "Exporting…"
              : planning && !planReady
                ? "Calculating…"
                : `Export ${exportEstimate} video${exportEstimate === 1 ? "" : "s"}`}
          </button>
          {running && (
            <button
              type="button"
              onClick={() => {
                cancelRef.current = true;
              }}
              className="rounded-xl border border-border-subtle px-4 py-2.5 text-sm"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={planning}
            onClick={() => void planRun()}
            className="rounded-xl border border-border-subtle px-4 py-2.5 text-sm hover:bg-surface-hover disabled:opacity-60"
          >
            {planning ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Refreshing…
              </span>
            ) : (
              "Refresh estimate"
            )}
          </button>
        </div>

        {running && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span className="truncate pr-4">{progress.label}</span>
              <span className="shrink-0 tabular-nums">
                {progress.current} / {progress.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
              <div
                className="h-full bg-accent transition-[width] duration-300 ease-out"
                style={{
                  width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        {summary && (
          <p className="mt-4 text-sm text-muted">
            Done — {summary.created} created, {summary.failed} failed,{" "}
            {summary.skipped} skipped (already existed).
          </p>
        )}

        {lastRunFolder && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-border-subtle bg-background/50 p-3 text-sm">
            <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div>
              <p className="font-medium">Saved to disk</p>
              <p className="mt-0.5 font-mono text-xs text-muted">
                public/exports/runs/{lastRunFolder}/
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ProduceSkeleton() {
  return (
    <section className="rounded-2xl border border-border-subtle bg-surface-raised/40 p-5">
      <div className="mb-4 space-y-2">
        <div className="h-5 w-32 animate-pulse rounded bg-surface-hover" />
        <div className="h-3 w-48 animate-pulse rounded bg-surface-hover" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border-subtle bg-background/50 p-3"
          >
            <div className="mb-2 h-3 w-16 animate-pulse rounded bg-surface-hover" />
            <div className="h-8 w-10 animate-pulse rounded bg-surface-hover" />
          </div>
        ))}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  accent,
  hint,
  loading,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-background/50 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={cn(
          "font-display text-2xl font-bold tabular-nums leading-8",
          accent && "text-accent",
          loading && "animate-pulse text-muted/40",
        )}
      >
        {loading ? "0" : value}
      </p>
      <p className="min-h-[1rem] text-xs text-muted">{hint ?? "\u00a0"}</p>
    </div>
  );
}
