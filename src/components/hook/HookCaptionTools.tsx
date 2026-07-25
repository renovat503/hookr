"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Loader2, MessageSquareText, Wand2 } from "lucide-react";
import type { LibraryCaption } from "@/lib/types";
import { cn } from "@/lib/utils";

type HookCaptionToolsProps = {
  overlayText: string;
  onSelect: (text: string, captionId?: string | null) => void;
  onLibraryChange?: (captions: LibraryCaption[]) => void;
  refreshToken?: number;
};

const LIBRARY_VISIBLE = 6;

export function HookCaptionTools({
  overlayText,
  onSelect,
  onLibraryChange,
  refreshToken = 0,
}: HookCaptionToolsProps) {
  const [captions, setCaptions] = useState<LibraryCaption[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [geminiOpen, setGeminiOpen] = useState(false);
  const [aiTheme, setAiTheme] = useState("");
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCaptions = useCallback(async () => {
    setLoadingLibrary(true);
    try {
      const res = await fetch("/api/library/captions");
      if (!res.ok) throw new Error("Could not load caption library.");
      const json = (await res.json()) as { captions: LibraryCaption[] };
      const next = json.captions ?? [];
      setCaptions(next);
      onLibraryChange?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load captions.");
    } finally {
      setLoadingLibrary(false);
    }
  }, [onLibraryChange]);

  useEffect(() => {
    void loadCaptions();
  }, [loadCaptions, refreshToken]);

  const generateSuggestions = async () => {
    setGenerating(true);
    setError(null);
    setAiSuggestions([]);
    try {
      const res = await fetch("/api/captions/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: 5,
          theme: aiTheme.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { captions?: string[]; error?: string };
      if (!res.ok) throw new Error(json.error || "Generation failed.");
      setAiSuggestions(json.captions ?? []);
      setGeminiOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  const visibleCaptions =
    libraryExpanded || captions.length <= LIBRARY_VISIBLE
      ? captions
      : captions.slice(0, LIBRARY_VISIBLE);

  const hiddenCaptionCount = Math.max(0, captions.length - LIBRARY_VISIBLE);

  const activeText = overlayText.trim().toLowerCase();

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface-raised/60">
          <button
            type="button"
            onClick={() => setLibraryOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
          >
            <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted">
              <MessageSquareText className="h-3.5 w-3.5 text-accent" />
              Caption library
            </span>
            {libraryOpen ? (
              <ChevronUp className="h-3.5 w-3.5 text-muted" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted" />
            )}
          </button>

          {libraryOpen && (
            <div className="border-t border-border px-3 pb-3 pt-2">
              {loadingLibrary ? (
                <div className="flex items-center justify-center py-6 text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : captions.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted">
                  No captions in library yet.{" "}
                  <Link
                    href="/library?tab=captions"
                    className="text-accent hover:underline"
                  >
                    Add in Library → Captions
                  </Link>
                </p>
              ) : (
                <ul className="max-h-44 space-y-1.5 overflow-y-auto">
                  {visibleCaptions.map((caption) => {
                    const active =
                      activeText === caption.text.trim().toLowerCase();
                    return (
                      <li key={caption.id}>
                        <button
                          type="button"
                          onClick={() => onSelect(caption.text, caption.id)}
                          className={cn(
                            "w-full rounded-lg border px-2.5 py-2 text-left text-sm leading-snug transition-colors",
                            active
                              ? "border-accent bg-accent/10 text-foreground"
                              : "border-border bg-background/50 hover:border-muted hover:bg-surface-hover",
                          )}
                        >
                          {caption.text}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {hiddenCaptionCount > 0 && !libraryExpanded && (
                <button
                  type="button"
                  onClick={() => setLibraryExpanded(true)}
                  className="mt-2 w-full text-xs text-accent hover:underline"
                >
                  Show {hiddenCaptionCount} more
                </button>
              )}
              {libraryExpanded && captions.length > LIBRARY_VISIBLE && (
                <button
                  type="button"
                  onClick={() => setLibraryExpanded(false)}
                  className="mt-2 w-full text-xs text-muted hover:text-foreground"
                >
                  Show less
                </button>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface-raised/60">
          <button
            type="button"
            onClick={() => setGeminiOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
          >
            <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted">
              <Wand2 className="h-3.5 w-3.5 text-accent" />
              Generate with Gemini
            </span>
            {geminiOpen ? (
              <ChevronUp className="h-3.5 w-3.5 text-muted" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted" />
            )}
          </button>

          {geminiOpen && (
            <div className="space-y-2 border-t border-border px-3 pb-3 pt-2">
              <input
                value={aiTheme}
                onChange={(e) => setAiTheme(e.target.value)}
                placeholder="Topic or niche (optional)"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={generating}
                onClick={() => void generateSuggestions()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg disabled:opacity-50"
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                {generating ? "Generating…" : "Generate 5 suggestions"}
              </button>
              {aiSuggestions.length > 0 && (
                <ul className="max-h-44 space-y-1.5 overflow-y-auto pt-1">
                  {aiSuggestions.map((text) => {
                    const active = activeText === text.trim().toLowerCase();
                    return (
                      <li key={text}>
                        <button
                          type="button"
                          onClick={() => onSelect(text)}
                          className={cn(
                            "w-full rounded-lg border px-2.5 py-2 text-left text-sm leading-snug transition-colors",
                            active
                              ? "border-accent bg-accent/10"
                              : "border-border bg-background/50 hover:border-muted hover:bg-surface-hover",
                          )}
                        >
                          {text}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-[11px] text-muted">
                Uses your caption library as style reference when available.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
