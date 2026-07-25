import type { OverlayStyle } from "./types";

export function resolveOverlayPosition(style: OverlayStyle): {
  x: number;
  y: number;
} {
  if (style.positionX != null && style.positionY != null) {
    return {
      x: clampPercent(style.positionX),
      y: clampPercent(style.positionY),
    };
  }

  switch (style.layout) {
    case "caption-top":
      return { x: 50, y: 12 };
    case "caption-bottom":
      return { x: 50, y: 88 };
    case "center":
    default:
      return { x: 50, y: 50 };
  }
}

export function hasCustomOverlayPosition(style: OverlayStyle): boolean {
  return style.positionX != null && style.positionY != null;
}

export function clampPercent(value: number): number {
  return Math.min(95, Math.max(5, value));
}

export function layoutFromPosition(style: OverlayStyle): OverlayStyle["layout"] {
  const { y } = resolveOverlayPosition(style);
  if (y <= 22) return "caption-top";
  if (y >= 78) return "caption-bottom";
  return "center";
}
