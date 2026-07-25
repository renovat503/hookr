import { hashCaption, normalizeCaptionText } from "./caption-hash";
import type { LibraryExport } from "./types";

export { hashCaption, normalizeCaptionText };

export function normalizeExportMusicId(
  musicId: string | null | undefined,
): string | null {
  return musicId ?? null;
}

export function resolveExportCaptionHash(
  overlayText: string | null | undefined,
): string {
  return hashCaption(overlayText ?? "");
}

export function findExistingExportCombo(
  exports: LibraryExport[],
  options: {
    hookId?: string | null;
    demoId?: string | null;
    hookUrl: string;
    demoUrl: string;
    musicId?: string | null;
    overlayText?: string | null;
    captionHash?: string | null;
  },
): LibraryExport | undefined {
  const { hookId, demoId, hookUrl, demoUrl } = options;
  const requestMusic = normalizeExportMusicId(options.musicId);
  const requestCaptionHash =
    options.captionHash ??
    resolveExportCaptionHash(options.overlayText ?? "");

  return exports.find((exp) => {
    const hookDemoMatch =
      (hookId &&
        demoId &&
        exp.hookId === hookId &&
        exp.demoId === demoId) ||
      (exp.hookUrl === hookUrl && exp.demoUrl === demoUrl);

    if (!hookDemoMatch) return false;
    if (normalizeExportMusicId(exp.musicId) !== requestMusic) return false;

    const expCaptionHash =
      exp.captionHash ?? resolveExportCaptionHash(exp.overlayText);
    return expCaptionHash === requestCaptionHash;
  });
}

export function isExportComboUsed(
  exports: LibraryExport[],
  hook: { id: string; url: string; overlayText?: string },
  demo: { id: string; url: string },
  musicId?: string | null,
  overlayText?: string | null,
): boolean {
  const caption =
    overlayText !== undefined ? overlayText : (hook.overlayText ?? "");
  return Boolean(
    findExistingExportCombo(exports, {
      hookId: hook.id,
      demoId: demo.id,
      hookUrl: hook.url,
      demoUrl: demo.url,
      musicId: normalizeExportMusicId(musicId),
      overlayText: caption,
    }),
  );
}

export function countAvailableCombos(
  exports: LibraryExport[],
  hooks: Array<{ id: string; url: string; overlayText?: string }>,
  demos: Array<{ id: string; url: string }>,
  musicId?: string | null,
): number {
  let count = 0;
  for (const hook of hooks) {
    for (const demo of demos) {
      if (
        !isExportComboUsed(
          exports,
          hook,
          demo,
          musicId,
          hook.overlayText ?? "",
        )
      ) {
        count += 1;
      }
    }
  }
  return count;
}

export function exportComboErrorMessage(
  musicId?: string | null,
  hasCaption?: boolean,
): string {
  if (normalizeExportMusicId(musicId)) {
    return hasCaption
      ? "This hook, demo, caption, and music track have already been combined. Delete the finished video, change the caption or music, or pick a different hook or demo."
      : "This hook, demo, and music track have already been combined. Delete the finished video, change the music, or pick a different hook or demo.";
  }
  return hasCaption
    ? "This hook, demo, and caption have already been combined. Delete the finished video, use a different caption, or pick a different hook or demo."
    : "This hook and demo have already been combined. Delete the finished video, add a music track for new variants, or pick a different hook or demo.";
}
