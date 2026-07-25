import { DEFAULT_OVERLAY_STYLE } from "./constants";
import type { OverlayStyle } from "./types";

export function mergeOverlayStyle(
  partial?: Partial<OverlayStyle> | null,
): OverlayStyle {
  return { ...DEFAULT_OVERLAY_STYLE, ...(partial ?? {}) };
}

export function overlayStylesEqual(
  a?: Partial<OverlayStyle> | null,
  b?: Partial<OverlayStyle> | null,
): boolean {
  return (
    JSON.stringify(mergeOverlayStyle(a)) === JSON.stringify(mergeOverlayStyle(b))
  );
}

export function hookNeedsOverlayBurn(options: {
  text: string;
  storedText?: string;
  overlayBurned?: boolean;
  storedStyle?: Partial<OverlayStyle> | null;
  requestedStyle?: Partial<OverlayStyle> | null;
}): boolean {
  const text = options.text.trim();
  if (!text) return false;

  const storedText = (options.storedText ?? "").trim();
  if (!options.overlayBurned) return true;
  if (text !== storedText) return true;

  if (
    options.requestedStyle != null &&
    !overlayStylesEqual(options.storedStyle, options.requestedStyle)
  ) {
    return true;
  }

  return false;
}
