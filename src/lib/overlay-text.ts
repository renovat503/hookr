export type OverlayTextSegment = {
  kind: "text" | "emoji";
  value: string;
};

/** Emoji sequences including variation selectors and ZWJ chains. */
const EMOJI_SEGMENT_RE =
  /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;

export function splitOverlayTextSegments(text: string): OverlayTextSegment[] {
  if (!text) return [];

  const segments: OverlayTextSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(EMOJI_SEGMENT_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ kind: "text", value: text.slice(lastIndex, index) });
    }
    segments.push({ kind: "emoji", value: match[0] });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: "text", value: text.slice(lastIndex) });
  }

  if (!segments.length) {
    segments.push({ kind: "text", value: text });
  }

  return segments;
}
