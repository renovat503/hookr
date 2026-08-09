"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Clapperboard,
  Copy,
  FolderKanban,
  Loader2,
  LogOut,
  Plus,
  Trash2,
} from "lucide-react";
import type { Campaign } from "@/lib/types";
import { isCampaignClosed } from "@/lib/campaign-status";
import { cn, friendlyFetchError } from "@/lib/utils";

type CampaignListItem = Campaign & {
  scheduledCount?: number;
  scheduledInstagram?: number;
  scheduledYouTube?: number;
};

function campaignInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "C";
}

function formatCount(n: number) {
  return new Intl.NumberFormat().format(n);
}

function CampaignsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        signal: AbortSignal.timeout(35_000),
      });
      const json = (await res.json()) as {
        campaigns?: CampaignListItem[];
        activeId?: string | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || "Could not load campaigns.");
      }
      setCampaigns(json.campaigns ?? []);
      setActiveId(json.activeId ?? null);
    } catch (err) {
      setError(friendlyFetchError(err, "Could not load campaigns."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const ordered = useMemo(() => {
    return [...campaigns].sort((a, b) => {
      if (a.id === activeId) return -1;
      if (b.id === activeId) return 1;
      if (isCampaignClosed(a) !== isCampaignClosed(b)) {
        return isCampaignClosed(a) ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [campaigns, activeId]);

  const totals = useMemo(() => {
    return campaigns.reduce(
      (acc, c) => {
        acc.scheduled += c.scheduledCount ?? 0;
        acc.instagram += c.scheduledInstagram ?? 0;
        acc.youtube += c.scheduledYouTube ?? 0;
        return acc;
      },
      { scheduled: 0, instagram: 0, youtube: 0 },
    );
  }, [campaigns]);

  const activate = async (id: string) => {
    setActivating(id);
    try {
      const res = await fetch(`/api/campaigns/${id}/activate`, { method: "POST" });
      if (!res.ok) throw new Error("Could not activate campaign.");
      router.push(next || "/produce");
      router.refresh();
    } finally {
      setActivating(null);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  const duplicateCampaign = async (id: string, name: string) => {
    if (
      !window.confirm(
        `Duplicate “${name}”? Hooks, demo selection, captions, and audio settings will be copied. Exports stay empty in the new campaign.`,
      )
    ) {
      return;
    }

    setDuplicatingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error || "Could not duplicate campaign.");
      }
      router.push("/campaign/settings");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not duplicate campaign.",
      );
    } finally {
      setDuplicatingId(null);
    }
  };

  const deleteCampaign = async (id: string, name: string) => {
    if (
      !window.confirm(
        `Delete “${name}”? This cannot be undone. Your library assets and exports are kept.`,
      )
    ) {
      return;
    }

    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not delete campaign.");
      if (activeId === id) {
        setActiveId(null);
        router.refresh();
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete campaign.");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <header className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-display text-sm font-semibold tracking-[0.18em] text-accent uppercase">
              Hookr
            </p>
            <h1 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">
              Campaigns
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
              Pick a campaign to produce, schedule, and publish. Active campaign
              stays pinned to the top.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/campaigns/new"
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              New campaign
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm text-muted transition hover:border-border hover:bg-surface-hover hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </div>
        </div>

        {campaigns.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-border-subtle bg-surface/50 px-4 py-3">
              <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                Campaigns
              </p>
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
                {formatCount(campaigns.length)}
              </p>
            </div>
            <div className="rounded-2xl border border-border-subtle bg-surface/50 px-4 py-3">
              <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                Scheduled
              </p>
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
                {formatCount(totals.scheduled)}
              </p>
            </div>
            <div className="rounded-2xl border border-border-subtle bg-surface/50 px-4 py-3">
              <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                Instagram
              </p>
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
                {formatCount(totals.instagram)}
              </p>
            </div>
            <div className="rounded-2xl border border-border-subtle bg-surface/50 px-4 py-3">
              <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                YouTube
              </p>
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
                {formatCount(totals.youtube)}
              </p>
            </div>
          </div>
        ) : null}
      </header>

      {error ? (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {campaigns.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border px-6 py-20 text-center">
          <FolderKanban className="mx-auto h-10 w-10 text-muted/40" />
          <p className="mt-4 font-display text-xl font-semibold">No campaigns yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            Create a campaign to start producing hooks, demos, and scheduled posts.
          </p>
          <Link
            href="/campaigns/new"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg"
          >
            <Plus className="h-4 w-4" />
            Create campaign
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {ordered.map((c, index) => {
            const isActive = activeId === c.id;
            const closed = isCampaignClosed(c);
            const busy =
              activating === c.id ||
              duplicatingId === c.id ||
              deletingId === c.id;

            return (
              <motion.li
                key={c.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: Math.min(index * 0.04, 0.24) }}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border transition",
                  isActive
                    ? "border-accent/40 bg-accent/[0.06]"
                    : "border-border-subtle bg-surface/40 hover:border-border hover:bg-surface-raised/60",
                  closed && "opacity-70",
                )}
              >
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
                  <div
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl font-display text-sm font-bold tracking-wide",
                      isActive
                        ? "bg-accent text-accent-fg"
                        : "bg-surface-raised text-muted",
                    )}
                    aria-hidden
                  >
                    {campaignInitials(c.name)}
                  </div>

                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-display text-xl font-semibold tracking-tight">
                        {c.name}
                      </h2>
                      {isActive ? (
                        <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-accent uppercase">
                          Active
                        </span>
                      ) : null}
                      {closed ? (
                        <span className="rounded-md border border-border-subtle px-2 py-0.5 text-[11px] font-medium text-muted">
                          Closed
                        </span>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <Clapperboard className="h-3.5 w-3.5" />
                        {formatCount(c.hookIds.length)} hooks ·{" "}
                        {formatCount(c.demoIds.length)} demos
                      </span>
                      <span>
                        {c.useCaptions
                          ? `${formatCount(c.captionIds.length)} captions`
                          : "no captions"}
                        {" · "}
                        {c.audioMode === "none"
                          ? "silent"
                          : c.audioMode === "random"
                            ? "random music"
                            : "fixed track"}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-0.5">
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-background/40 px-2.5 py-1 text-xs tabular-nums text-foreground">
                        <span className="text-muted">Scheduled</span>
                        <span className="font-semibold">
                          {formatCount(c.scheduledCount ?? 0)}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-background/40 px-2.5 py-1 text-xs tabular-nums text-foreground">
                        <span className="text-muted">IG</span>
                        <span className="font-semibold">
                          {formatCount(c.scheduledInstagram ?? 0)}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-background/40 px-2.5 py-1 text-xs tabular-nums text-foreground">
                        <span className="text-muted">YT</span>
                        <span className="font-semibold">
                          {formatCount(c.scheduledYouTube ?? 0)}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void activate(c.id)}
                      className={cn(
                        "inline-flex min-w-[7.5rem] items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50",
                        closed
                          ? "border border-border text-foreground hover:bg-surface-hover"
                          : "bg-accent text-accent-fg hover:brightness-110",
                      )}
                    >
                      {activating === c.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isActive ? (
                        "Open"
                      ) : (
                        "Use campaign"
                      )}
                    </button>
                    <button
                      type="button"
                      title="Duplicate"
                      disabled={busy}
                      onClick={() => void duplicateCampaign(c.id, c.name)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
                    >
                      {duplicatingId === c.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      disabled={busy}
                      onClick={() => void deleteCampaign(c.id, c.name)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted transition hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                    >
                      {deletingId === c.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function CampaignsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      }
    >
      <CampaignsContent />
    </Suspense>
  );
}
