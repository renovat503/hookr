import type { CSSProperties, ReactNode } from "react";
import type { OverlayStyle } from "@/lib/types";
import {
  CAPTION_FRAME,
  CAPTION_SIDE_MARGIN_PX,
} from "@/lib/caption-frame";
import { resolveOverlayPosition } from "@/lib/overlay-position";
import { splitOverlayTextSegments } from "@/lib/overlay-text";
import { cn } from "@/lib/utils";

export { CAPTION_FRAME, CAPTION_SIDE_MARGIN_PX };

export function captionBandStyle(
  positionY: number,
): { top: string; transform: string } {
  return {
    top: `${positionY}%`,
    transform: "translateY(-50%)",
  };
}

export function overlayFontClass(style: OverlayStyle) {
  if (style.fontFamily === "impact" || style.fontFamily === "arial-black") {
    return "tracking-wide";
  }
  if (style.fontFamily === "georgia" || style.fontFamily === "times") {
    return "font-serif tracking-tight";
  }
  if (style.fontFamily === "courier") {
    return "font-mono tracking-tight";
  }
  if (style.fontFamily === "bricolage-grotesque") {
    return "tracking-tight";
  }
  return "font-sans tracking-tight";
}

export function overlayFontFamily(style: OverlayStyle): string {
  switch (style.fontFamily) {
    case "impact":
      return "Impact, Haettenschweiler, 'Arial Black', sans-serif";
    case "arial-black":
      return "'Arial Black', 'Helvetica Neue', Arial, sans-serif";
    case "helvetica":
      return "Helvetica, Arial, sans-serif";
    case "georgia":
      return "Georgia, 'Times New Roman', serif";
    case "times":
      return "'Times New Roman', Times, serif";
    case "courier":
      return "'Courier New', Courier, monospace";
    case "rounded":
      return "'Arial Rounded MT Bold', 'Helvetica Rounded', Arial, sans-serif";
    case "bricolage-grotesque":
      return "var(--font-bricolage), 'Bricolage Grotesque', sans-serif";
    case "arial":
    default:
      return "Arial, Helvetica, sans-serif";
  }
}

export function overlayStyleClass(style: OverlayStyle) {
  return style.highlight ? "bg-black/75" : "";
}

export function overlayPaddingClass(style: OverlayStyle) {
  return style.highlight ? "rounded-[18px] px-[28px] py-[18px]" : "";
}

/** Build an 8-direction outline shadow for thicker borders (works well in PNG capture). */
export function buildTextBorderShadow(
  borderWidth: number,
  borderColor: string,
): string | undefined {
  const w = Math.max(0, Math.min(20, Math.round(borderWidth || 0)));
  if (w <= 0) return undefined;

  const color = borderColor || "#000000";
  const offsets: Array<[number, number]> = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];

  const layers: string[] = [];
  for (let i = 1; i <= w; i++) {
    for (const [dx, dy] of offsets) {
      layers.push(`${dx * i}px ${dy * i}px 0 ${color}`);
    }
  }
  return layers.join(", ");
}

export function previewTextShadow(style: OverlayStyle): string | undefined {
  const borderShadow = buildTextBorderShadow(
    style.borderWidth ?? 0,
    style.borderColor || "#000000",
  );

  const hasBorder = (style.borderWidth ?? 0) > 0;
  const soft =
    !style.highlight && !hasBorder ? "0 3px 10px rgba(0,0,0,0.85)" : undefined;

  if (borderShadow && soft) return `${borderShadow}, ${soft}`;
  return borderShadow ?? soft;
}

export function captionDisplayText(text: string, style: OverlayStyle) {
  return style.uppercase ? text.toUpperCase() : text;
}

export function captionParagraphStyle(style: OverlayStyle): CSSProperties {
  return {
    textAlign: style.align ?? "center",
    lineHeight: 1.15,
    maxWidth: "100%",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };
}

export function captionTextSpanStyle(style: OverlayStyle): CSSProperties {
  return {
    color: style.textColor || "#FFFFFF",
    fontFamily: overlayFontFamily(style),
    fontSize: `${Math.max(20, Math.min(120, style.fontSize || 48))}px`,
    fontWeight: style.bold ? 800 : 500,
    fontStyle: style.italic ? "italic" : "normal",
    textShadow: previewTextShadow(style),
  };
}

export function captionEmojiSpanStyle(style: OverlayStyle): CSSProperties {
  const fontSize = Math.max(20, Math.min(120, style.fontSize || 48));
  return {
    fontFamily:
      "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif",
    fontSize: `${fontSize}px`,
    lineHeight: 1.15,
    fontStyle: "normal",
    fontWeight: "normal",
    textShadow: "none",
    WebkitTextStroke: "0 transparent",
  };
}

export function CaptionTextContent({
  text,
  style,
}: {
  text: string;
  style: OverlayStyle;
}): ReactNode {
  const segments = splitOverlayTextSegments(text);

  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "emoji" ? (
          <span
            key={`emoji-${index}-${segment.value}`}
            className="inline"
            style={captionEmojiSpanStyle(style)}
          >
            {segment.value}
          </span>
        ) : (
          <span
            key={`text-${index}-${segment.value}`}
            className={cn(
              overlayFontClass(style),
              style.uppercase && "uppercase",
            )}
            style={captionTextSpanStyle(style)}
          >
            {segment.value}
          </span>
        ),
      )}
    </>
  );
}

export function captionTextStyle(style: OverlayStyle): CSSProperties {
  return {
    ...captionParagraphStyle(style),
    ...captionTextSpanStyle(style),
  };
}

type CaptionOverlayProps = {
  text: string;
  style: OverlayStyle;
  className?: string;
  /** When true, fills a 1080x1920 absolute frame for capture */
  frame?: boolean;
};

export function CaptionOverlay({
  text,
  style,
  className,
  frame = false,
}: CaptionOverlayProps) {
  if (!text.trim()) return null;

  const position = resolveOverlayPosition(style);

  return (
    <div
      className={cn(
        "pointer-events-none",
        frame ? "absolute inset-0 h-full w-full" : "absolute inset-0",
        className,
      )}
    >
      <div
        className="absolute"
        style={{
          left: CAPTION_SIDE_MARGIN_PX,
          right: CAPTION_SIDE_MARGIN_PX,
          ...captionBandStyle(position.y),
        }}
      >
        <p
          className={cn(
            overlayPaddingClass(style),
            overlayStyleClass(style),
            "w-full",
          )}
          style={captionParagraphStyle(style)}
        >
          <CaptionTextContent text={text} style={style} />
        </p>
      </div>
    </div>
  );
}
