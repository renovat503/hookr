"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { Campaign, CampaignBorrowAssetKind } from "@/lib/types";

export function CampaignForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [borrowFromCampaignId, setBorrowFromCampaignId] = useState("");
  const [borrowAssetKind, setBorrowAssetKind] =
    useState<CampaignBorrowAssetKind | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/campaigns")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { campaigns?: Campaign[] } | null) => {
        setCampaigns(data?.campaigns ?? []);
      })
      .catch(() => undefined);
  }, []);

  const setBorrowHooksFrom = (sourceId: string) => {
    setBorrowFromCampaignId(sourceId);
    setBorrowAssetKind(sourceId ? "hooks" : "");
  };

  const setBorrowDemosFrom = (sourceId: string) => {
    setBorrowFromCampaignId(sourceId);
    setBorrowAssetKind(sourceId ? "demos" : "");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: {
        name: string;
        activate: boolean;
        borrowFromCampaignId?: string;
        borrowAssetKind?: CampaignBorrowAssetKind;
      } = { name, activate: true };

      if (borrowFromCampaignId && borrowAssetKind) {
        body.borrowFromCampaignId = borrowFromCampaignId;
        body.borrowAssetKind = borrowAssetKind;
      }

      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not create campaign.");
      router.push("/campaign/settings");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create campaign.");
    } finally {
      setSaving(false);
    }
  };

  const borrowSource = campaigns.find((c) => c.id === borrowFromCampaignId);

  return (
    <form onSubmit={(e) => void submit(e)} className="mx-auto max-w-lg space-y-8 px-6 py-12">
      <div>
        <Link
          href="/campaigns"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to campaigns
        </Link>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          New campaign
        </h1>
        <p className="mt-2 text-sm text-muted">
          Name your campaign, optionally reuse hooks or demos from another
          campaign — not both. You pick the other asset type yourself in
          settings.
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted">
          Campaign name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          placeholder="e.g. July Marketplace batch"
          className="w-full rounded-xl border border-border-subtle bg-background px-3 py-2.5 text-sm"
        />
      </div>

      {campaigns.length > 0 ? (
        <div className="space-y-4 rounded-xl border border-border-subtle bg-surface-raised/40 p-4">
          <div>
            <p className="text-sm font-medium">Reuse from another campaign</p>
            <p className="mt-1 text-xs text-muted">
              Optional. Link hooks or demos — never both. Leave both on “None”
              to pick all assets manually after creating.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">
                Reuse hooks from
              </label>
              <select
                value={borrowAssetKind === "hooks" ? borrowFromCampaignId : ""}
                onChange={(e) => setBorrowHooksFrom(e.target.value)}
                className="w-full rounded-xl border border-border-subtle bg-background px-3 py-2 text-sm"
              >
                <option value="">None</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">
                Reuse demos from
              </label>
              <select
                value={borrowAssetKind === "demos" ? borrowFromCampaignId : ""}
                onChange={(e) => setBorrowDemosFrom(e.target.value)}
                className="w-full rounded-xl border border-border-subtle bg-background px-3 py-2 text-sm"
              >
                <option value="">None</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {borrowSource && borrowAssetKind ? (
            <p className="text-xs text-accent">
              {borrowAssetKind === "hooks"
                ? `Hooks will mirror “${borrowSource.name}”. You’ll choose demos for this campaign in settings.`
                : `Demos will mirror “${borrowSource.name}”. You’ll choose hooks for this campaign in settings.`}
            </p>
          ) : null}
        </div>
      ) : null}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={saving || !name.trim()}
        className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-accent-fg disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Create campaign
      </button>
    </form>
  );
}
