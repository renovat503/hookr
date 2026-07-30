"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Sparkles, Trash2, Upload, Wand2, X } from "lucide-react";
import type { LibraryCaption } from "@/lib/types";

type CaptionLibraryPanelProps = {
  onChange?: (captions: LibraryCaption[]) => void;
  onImported?: () => void;
  /** When set, only captions in this campaign selection are shown. */
  visibleIds?: string[] | null;
  campaignName?: string | null;
};

export function CaptionLibraryPanel({
  onChange,
  onImported,
  visibleIds = null,
  campaignName = null,
}: CaptionLibraryPanelProps) {
  const [captions, setCaptions] = useState<LibraryCaption[]>([]);
  const [importText, setImportText] = useState("");
  const [aiTheme, setAiTheme] = useState("");
  const [aiCount, setAiCount] = useState(20);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/library/captions");
      if (!res.ok) throw new Error("Could not load captions.");
      const json = (await res.json()) as { captions: LibraryCaption[] };
      const all = json.captions ?? [];
      const visibleSet =
        visibleIds != null ? new Set(visibleIds) : null;
      const next = visibleSet
        ? all.filter((c) => visibleSet.has(c.id))
        : all;
      setCaptions(next);
      onChange?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load captions.");
    } finally {
      setLoading(false);
    }
  }, [onChange, visibleIds]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleImport = async () => {
    if (!importText.trim()) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch("/api/library/captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ import: importText }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Import failed.");
      setImportText("");
      onImported?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const handleAiExpand = async () => {
    setGeneratingAi(true);
    setError(null);
    try {
      const res = await fetch("/api/captions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: aiCount,
          theme: aiTheme.trim() || undefined,
          saveToLibrary: true,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "AI generation failed.");
      onImported?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI generation failed.");
    } finally {
      setGeneratingAi(false);
    }
  };

  const deleteCaption = async (id: string) => {
    setError(null);
    const res = await fetch(
      `/api/library/captions?id=${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      setError(json.error || "Could not delete caption.");
      return;
    }
    if (editingId === id) {
      setEditingId(null);
      setEditingText("");
    }
    await load();
  };

  const startEditing = (caption: LibraryCaption) => {
    setEditingId(caption.id);
    setEditingText(caption.text);
    setError(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingText("");
  };

  const saveCaption = async (id: string) => {
    const text = editingText.trim();
    if (!text) {
      setError("Caption text cannot be empty.");
      return;
    }

    setSavingId(id);
    setError(null);
    try {
      const res = await fetch("/api/library/captions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, text }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not save caption.");
      setEditingId(null);
      setEditingText("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save caption.");
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <p className="max-w-2xl text-sm text-muted">
        {campaignName ? (
          <>
            Captions selected for{" "}
            <span className="font-medium text-foreground">{campaignName}</span>.
            Import or generate lines below to add them to this campaign. Used by
            Produce when &quot;Burn captions&quot; is enabled in campaign
            settings.
          </>
        ) : (
          <>
            Import hook lines for on-video captions. Select a campaign to scope
            captions per campaign. Used by Produce when &quot;Burn captions&quot;
            is enabled.
          </>
        )}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">
            Import captions (one per line)
          </label>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={6}
            placeholder={
              "Wait for this trick…\nNobody talks about this hack\nPOV: you finally figured it out"
            }
            className="w-full rounded-xl border border-border-subtle bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={importing || !importText.trim()}
            onClick={() => void handleImport()}
            className="mt-2 inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Import to library
          </button>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">
            AI expand from your library (optional, ~$0.001)
          </label>
          <input
            value={aiTheme}
            onChange={(e) => setAiTheme(e.target.value)}
            placeholder="Theme or niche (optional)"
            className="mb-2 w-full rounded-xl border border-border-subtle bg-background px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={5}
              max={50}
              value={aiCount}
              onChange={(e) => setAiCount(Number(e.target.value))}
              className="w-20 rounded-xl border border-border-subtle bg-background px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={generatingAi || captions.length < 3}
              onClick={() => void handleAiExpand()}
              className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium hover:bg-surface-hover disabled:opacity-50"
            >
              {generatingAi ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              Generate more like mine
            </button>
          </div>
          {captions.length < 3 && (
            <p className="mt-2 text-xs text-muted">
              Add at least 3 captions before using AI expansion.
            </p>
          )}
        </div>
      </div>

      {captions.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {captions.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-border-subtle bg-surface/70 px-3 py-2.5 text-sm"
            >
              {editingId === c.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    rows={2}
                    autoFocus
                    className="w-full resize-none rounded-lg border border-border-subtle bg-background px-2.5 py-2 text-sm outline-none focus:border-accent/50"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelEditing();
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        void saveCaption(c.id);
                      }
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={savingId === c.id || !editingText.trim()}
                      onClick={() => void saveCaption(c.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50"
                    >
                      {savingId === c.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={savingId === c.id}
                      onClick={cancelEditing}
                      className="inline-flex items-center gap-1 rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">{c.text}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => startEditing(c)}
                      className="text-muted hover:text-foreground"
                      aria-label="Edit caption"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteCaption(c.id)}
                      className="text-muted hover:text-red-400"
                      aria-label="Delete caption"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-16 text-muted">
          <Sparkles className="h-10 w-10 opacity-30" />
          <p className="text-sm font-medium text-foreground/80">
            {campaignName ? "No captions for this campaign" : "No captions yet"}
          </p>
          <p className="max-w-xs text-center text-xs">
            {campaignName
              ? "Import hook lines above or select captions in Campaign settings."
              : "Paste hook lines above — one per line — or generate more from examples with AI."}
          </p>
        </div>
      )}
    </div>
  );
}
