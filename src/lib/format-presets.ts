import type { OverlayStyle } from "./types";
import { DEFAULT_OVERLAY_STYLE } from "./constants";

export type FormatPreset = {
  id: string;
  name: string;
  style: OverlayStyle;
  createdAt: string;
};

const STORAGE_KEY = "hookr-format-presets";

export function loadFormatPresets(): FormatPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FormatPreset[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p) =>
          p &&
          typeof p.id === "string" &&
          typeof p.name === "string" &&
          p.style &&
          typeof p.style === "object",
      )
      .map((p) => ({
        ...p,
        style: { ...DEFAULT_OVERLAY_STYLE, ...p.style },
      }));
  } catch {
    return [];
  }
}

export function saveFormatPresets(presets: FormatPreset[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function createFormatPreset(
  name: string,
  style: OverlayStyle,
): FormatPreset {
  return {
    id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || "Untitled",
    style: { ...style },
    createdAt: new Date().toISOString(),
  };
}

export function stylesMatch(a: OverlayStyle, b: OverlayStyle): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.align === b.align &&
    a.italic === b.italic &&
    a.uppercase === b.uppercase &&
    a.textColor === b.textColor &&
    a.borderWidth === b.borderWidth &&
    a.borderColor === b.borderColor &&
    a.bold === b.bold &&
    a.highlight === b.highlight &&
    a.layout === b.layout &&
    (a.positionX ?? null) === (b.positionX ?? null) &&
    (a.positionY ?? null) === (b.positionY ?? null)
  );
}
