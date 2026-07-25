"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FolderKanban, Loader2, LogOut, Plus, Trash2 } from "lucide-react";
import type { Campaign } from "@/lib/types";
import { isCampaignClosed } from "@/lib/campaign-status";
import { cn } from "@/lib/utils";

function CampaignsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await res.json()) as {
        campaigns?: Campaign[];
        activeId?: string | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || "Could not load campaigns.");
      }
      setCampaigns(json.campaigns ?? []);
      setActiveId(json.activeId ?? null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load campaigns.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

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
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-accent">
            Campaigns
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">
            Choose or create a campaign
          </h1>
          <p className="mt-2 max-w-lg text-sm text-muted">
            Create a campaign with a name, then configure hooks, demos, captions,
            and audio inside the app.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/campaigns/new"
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg"
          >
            <Plus className="h-4 w-4" />
            New campaign
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex items-center gap-2 rounded-xl border border-border-subtle px-4 py-2.5 text-sm text-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <FolderKanban className="mx-auto h-10 w-10 text-muted/40" />
          <p className="mt-3 font-medium">No campaigns yet</p>
          <p className="mt-1 text-sm text-muted">
            Create a campaign to get started — you can add assets after.
          </p>
          <Link
            href="/campaigns/new"
            className="mt-4 inline-block text-sm text-accent hover:underline"
          >
            Create campaign →
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {campaigns.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-border-subtle bg-surface-raised/40 p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-display text-lg font-semibold">{c.name}</p>
                  {isCampaignClosed(c) ? (
                    <span className="rounded-full border border-border-subtle bg-surface-raised px-2 py-0.5 text-[11px] font-medium text-muted">
                      Closed
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {c.hookIds.length} hooks · {c.demoIds.length} demos ·{" "}
                  {c.useCaptions ? `${c.captionIds.length} captions` : "no captions"} ·{" "}
                  {c.audioMode === "none"
                    ? "silent"
                    : c.audioMode === "random"
                      ? "random music"
                      : "fixed track"}
                </p>
                {activeId === c.id && (
                  <span className="mt-1 inline-block text-xs font-medium text-accent">
                    Active
                  </span>
                )}
              </div>
              <button
                type="button"
                disabled={activating === c.id}
                onClick={() => void activate(c.id)}
                className={cn(
                  "rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50",
                  isCampaignClosed(c)
                    ? "border border-border-subtle hover:bg-surface-hover"
                    : "bg-accent text-accent-fg",
                )}
              >
                {activating === c.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : activeId === c.id ? (
                  "Open"
                ) : (
                  "Use campaign"
                )}
              </button>
              <button
                type="button"
                disabled={deletingId === c.id || activating === c.id}
                onClick={() => void deleteCampaign(c.id, c.name)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle px-3 py-2 text-sm text-muted hover:border-red-500/30 hover:text-red-400 disabled:opacity-50"
              >
                {deletingId === c.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete
              </button>
            </li>
          ))}
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
