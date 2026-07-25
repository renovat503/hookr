import { createHash } from "crypto";

/** Normalize caption text for dedup comparisons. */
export function normalizeCaptionText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function hashCaption(text: string): string {
  const normalized = normalizeCaptionText(text);
  if (!normalized) return "";
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function slugifyCaption(text: string, max = 36): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return slug || "caption";
}
