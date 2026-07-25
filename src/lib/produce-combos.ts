import { isExportComboUsed } from "./export-combos";
import type { LibraryData, LibraryHook, OverlayStyle } from "./types";

export type ProduceCombo = {
  hookId: string;
  demoId: string;
  musicId: string | null;
  overlayText: string;
  overlayStyle?: Partial<OverlayStyle>;
};

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function countProduceCombos(
  library: LibraryData,
  options: {
    hookIds?: string[];
    demoIds?: string[];
    captions: string[];
    musicIds: (string | null)[];
  },
): number {
  return buildProduceCombos(library, options).length;
}

export function buildProduceCombos(
  library: LibraryData,
  options: {
    hookIds?: string[];
    demoIds?: string[];
    captions: string[];
    musicIds: (string | null)[];
    shuffle?: boolean;
    maxCount?: number;
  },
): ProduceCombo[] {
  const hooks = (
    options.hookIds !== undefined
      ? library.hooks.filter((h) => options.hookIds!.includes(h.id))
      : library.hooks
  ) as LibraryHook[];
  const demos =
    options.demoIds !== undefined
      ? library.demos.filter((d) => options.demoIds!.includes(d.id))
      : library.demos;
  const trimmed = options.captions.map((c) => c.trim());
  /** Keep a single empty caption for hooks×demos-only runs (no on-video text). */
  const captions =
    trimmed.length === 1 && trimmed[0] === ""
      ? [""]
      : trimmed.filter(Boolean);
  const musicIds =
    options.musicIds.length > 0 ? options.musicIds : [null as string | null];

  if (!hooks.length || !demos.length || !captions.length) return [];

  const combos: ProduceCombo[] = [];
  for (const hook of hooks) {
    for (const demo of demos) {
      for (const caption of captions) {
        for (const musicId of musicIds) {
          if (
            isExportComboUsed(
              library.exports,
              hook,
              demo,
              musicId,
              caption,
            )
          ) {
            continue;
          }
          combos.push({
            hookId: hook.id,
            demoId: demo.id,
            musicId,
            overlayText: caption,
          });
        }
      }
    }
  }

  const ordered = options.shuffle ? shuffle(combos) : combos;
  if (options.maxCount != null && options.maxCount > 0) {
    return ordered.slice(0, options.maxCount);
  }
  return ordered;
}
