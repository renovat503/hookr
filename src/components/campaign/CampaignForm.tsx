"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";

export function CampaignForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, activate: true }),
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
          Start with an empty library for hooks, demos, captions, and exports.
          Motions and music stay shared. Duplicate an existing campaign from the
          campaigns list to copy hooks and settings.
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
