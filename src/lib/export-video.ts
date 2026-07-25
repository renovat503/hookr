import { appendFile, access, writeFile, mkdir } from "fs/promises";
import { constants as fsConstants } from "fs";
import path from "path";
import {
  burnTextOverlay,
  concatenateClips,
  createExportVariation,
  mixBackgroundMusic,
  safeUnlink,
  uniqueifyExportVideo,
} from "@/lib/ffmpeg";
import { addExport, readLibrary } from "@/lib/library-store";
import {
  resolveToLocalPath,
  saveMediaFromLocalPath,
} from "@/lib/storage/media";
import {
  exportComboErrorMessage,
  findExistingExportCombo,
  resolveExportCaptionHash,
} from "@/lib/export-combos";
import { slugifyCaption } from "@/lib/caption-hash";
import { resolveHookRawPath } from "@/lib/hook-raw";
import { hookNeedsOverlayBurn, mergeOverlayStyle } from "@/lib/overlay-style";
import { DEFAULT_MUSIC_VOLUME } from "@/lib/constants";
import type { ExportVariation, LibraryExport, OverlayStyle } from "@/lib/types";

export type ExportVideoInput = {
  hookId?: string | null;
  demoId?: string | null;
  hookUrl?: string;
  demoUrl?: string;
  hookActionPrompt?: string;
  demoName?: string;
  overlayText?: string;
  overlayStyle?: Partial<OverlayStyle>;
  overlayPngBase64?: string | null;
  musicId?: string | null;
  musicUrl?: string | null;
  musicVolume?: number;
  runFolder?: string | null;
  sequence?: number;
  campaignId?: string | null;
};

function sanitizeRunFolder(folder: string): string {
  return folder.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

async function appendManifestRow(
  runFolder: string,
  row: {
    filename: string;
    caption: string;
    hookId: string | null;
    demoId: string | null;
    demoName: string;
    musicName: string | null;
    url: string;
  },
) {
  const safe = sanitizeRunFolder(runFolder);
  const manifestDir = path.join(process.cwd(), "public", "exports", "runs", safe);
  await mkdir(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, "manifest.csv");
  const header =
    "filename,caption,hookId,demoId,demoName,musicName,url,createdAt\n";
  const line = [
    row.filename,
    `"${row.caption.replace(/"/g, '""')}"`,
    row.hookId ?? "",
    row.demoId ?? "",
    `"${row.demoName.replace(/"/g, '""')}"`,
    row.musicName ? `"${row.musicName.replace(/"/g, '""')}"` : "",
    row.url,
    new Date().toISOString(),
  ].join(",");

  let exists = false;
  try {
    await access(manifestPath, fsConstants.F_OK);
    exists = true;
  } catch {
    exists = false;
  }

  if (!exists) {
    await writeFile(manifestPath, header + line + "\n", "utf8");
  } else {
    await appendFile(manifestPath, line + "\n", "utf8");
  }
}

export async function exportLibraryVideo(
  body: ExportVideoInput,
): Promise<LibraryExport> {
  let overlaidTemp: string | null = null;
  let concatTemp: string | null = null;
  let mixedTemp: string | null = null;

  try {
    const library = await readLibrary();
    const hookMeta = body.hookId
      ? library.hooks.find((h) => h.id === body.hookId)
      : undefined;
    const demoMeta = body.demoId
      ? library.demos.find((d) => d.id === body.demoId)
      : undefined;
    const musicMeta = body.musicId
      ? library.music.find((m) => m.id === body.musicId)
      : undefined;

    const hookUrl = hookMeta?.url ?? body.hookUrl;
    const demoUrl = demoMeta?.url ?? body.demoUrl;
    const hookId = hookMeta?.id ?? body.hookId ?? null;
    const demoId = demoMeta?.id ?? body.demoId ?? null;
    const musicId = musicMeta?.id ?? body.musicId ?? null;
    const musicUrl = musicMeta?.url ?? body.musicUrl ?? null;
    const musicName = musicMeta?.name ?? null;
    const musicVolume = Math.min(
      100,
      Math.max(0, Math.round(body.musicVolume ?? DEFAULT_MUSIC_VOLUME)),
    );
    const hookActionPrompt = hookMeta?.actionPrompt ?? body.hookActionPrompt;
    const demoName = demoMeta?.name ?? body.demoName;
    /** Caption variant for dedup (empty = hook's baked-in overlay only). */
    const comboCaptionText =
      typeof body.overlayText === "string" ? body.overlayText.trim() : "";
    /** Label / manifest text — falls back to the hook's overlay copy. */
    const displayCaptionText =
      comboCaptionText || hookMeta?.overlayText?.trim() || "";

    if (!hookUrl || !demoUrl) {
      throw new Error("hookUrl and demoUrl are required.");
    }

    const captionHash = resolveExportCaptionHash(comboCaptionText);

    const duplicate = findExistingExportCombo(library.exports, {
      hookId,
      demoId,
      hookUrl,
      demoUrl,
      musicId,
      overlayText: comboCaptionText,
      captionHash,
    });
    if (duplicate) {
      throw new ExportDuplicateError(
        exportComboErrorMessage(musicId, Boolean(comboCaptionText)),
      );
    }

    const hookPath = await resolveToLocalPath(hookUrl);
    const demoPath = await resolveToLocalPath(demoUrl);

    const id = `export-${Date.now()}`;
    const seq = body.sequence ?? 0;
    const seqLabel = String(seq).padStart(3, "0");
    const slug = slugifyCaption(displayCaptionText || demoName || "video");

    let exportDir = path.join(process.cwd(), "public", "exports");
    let publicUrlPath = `/exports/${id}.mp4`;
    let filename = `${id}.mp4`;

    if (body.runFolder) {
      const safe = sanitizeRunFolder(body.runFolder);
      exportDir = path.join(exportDir, "runs", safe);
      filename = `${seqLabel}-${slug}.mp4`;
      publicUrlPath = `/exports/runs/${safe}/${filename}`;
    }

    await mkdir(exportDir, { recursive: true });
    const exportPath = path.join(exportDir, filename);
    concatTemp = path.join(process.cwd(), "tmp", `${id}-concat.mp4`);
    const variationSeed = Date.now();
    const variation = createExportVariation(variationSeed, Boolean(musicUrl));
    const storedVariation: ExportVariation = {
      seed: variation.seed,
      speed: variation.speed,
      trimStartMs: variation.trimStartMs,
      trimEndMs: variation.trimEndMs,
      ...(variation.musicStartOffsetSec != null
        ? { musicStartOffsetSec: variation.musicStartOffsetSec }
        : {}),
    };

    const resolvedHookMeta =
      hookMeta ??
      library.hooks.find((h) => h.url === hookUrl) ??
      library.hooks.find((h) => h.rawUrl === hookUrl);
    const alreadyBurned = Boolean(
      resolvedHookMeta?.overlayBurned && resolvedHookMeta.url === hookUrl,
    );
    const storedText = (resolvedHookMeta?.overlayText ?? "").trim();
    const resolvedStyle = mergeOverlayStyle({
      ...resolvedHookMeta?.overlayStyle,
      ...body.overlayStyle,
    });
    const shouldBurn = hookNeedsOverlayBurn({
      text: comboCaptionText || storedText,
      storedText,
      overlayBurned: alreadyBurned,
      storedStyle: resolvedHookMeta?.overlayStyle,
      requestedStyle: body.overlayStyle,
    });
    /** Text to burn when re-rendering overlay (combo caption or hook's own). */
    const burnText = comboCaptionText || storedText;

    let stitchHookPath = hookPath;
    if (shouldBurn && burnText) {
      overlaidTemp = path.join(process.cwd(), "tmp", `${id}-overlay.mp4`);
      let sourcePath = hookPath;
      if (resolvedHookMeta) {
        const resolved = await resolveHookRawPath(resolvedHookMeta);
        sourcePath = resolved.path;
      }
      await burnTextOverlay({
        inputPath: sourcePath,
        outputPath: overlaidTemp,
        text: burnText,
        style: resolvedStyle,
        overlayPngBase64: body.overlayPngBase64,
      });
      stitchHookPath = overlaidTemp;
    } else if (
      resolvedHookMeta?.overlayBurned &&
      storedText &&
      !comboCaptionText
    ) {
      // Produce / mix without extra captions — use the hook master with overlay baked in.
      stitchHookPath = await resolveToLocalPath(resolvedHookMeta.url);
    } else if (!comboCaptionText && !storedText && resolvedHookMeta) {
      const resolved = await resolveHookRawPath(resolvedHookMeta);
      stitchHookPath = resolved.path;
    }

    await concatenateClips({
      hookPath: stitchHookPath,
      demoPath,
      outputPath: concatTemp,
    });

    let preUniquePath = concatTemp;
    if (musicUrl) {
      mixedTemp = path.join(process.cwd(), "tmp", `${id}-mixed.mp4`);
      const musicPath = await resolveToLocalPath(musicUrl);
      await mixBackgroundMusic({
        videoPath: concatTemp,
        musicPath,
        outputPath: mixedTemp,
        musicVolume: musicVolume / 100,
        videoVolume: 0.85,
        musicStartOffsetSeconds: variation.musicStartOffsetSec,
      });
      preUniquePath = mixedTemp;
    }

    await uniqueifyExportVideo({
      inputPath: preUniquePath,
      outputPath: exportPath,
      variation,
    });

    const storageKey = publicUrlPath.replace(/^\/+/, "");
    const storedUrl = await saveMediaFromLocalPath({
      storageKey,
      localPath: exportPath,
      contentType: "video/mp4",
    });

    const name =
      demoName && displayCaptionText
        ? `${displayCaptionText.slice(0, 40)} + ${demoName}${musicName ? ` · ${musicName}` : ""}`
        : demoName
          ? `Hook + ${demoName}${musicName ? ` · ${musicName}` : ""}`
          : musicName
            ? `Finished short · ${musicName}`
            : "Finished short";

    const exp = await addExport({
      id,
      name,
      url: storedUrl,
      hookId,
      demoId,
      hookUrl,
      demoUrl,
      hookActionPrompt: hookActionPrompt ?? "",
      demoName: demoName ?? "Demo clip",
      overlayText: displayCaptionText,
      captionHash,
      musicId,
      musicName,
      musicVolume: musicId ? musicVolume : null,
      variation: storedVariation,
      runFolder: body.runFolder ? sanitizeRunFolder(body.runFolder) : null,
      campaignId: body.campaignId ?? null,
      status: "ready",
      createdAt: new Date().toISOString(),
    });

    if (body.runFolder) {
      await appendManifestRow(sanitizeRunFolder(body.runFolder), {
        filename,
        caption: displayCaptionText,
        hookId,
        demoId,
        demoName: demoName ?? "Demo clip",
        musicName,
        url: storedUrl,
      });
    }

    return exp;
  } finally {
    if (overlaidTemp) await safeUnlink(overlaidTemp);
    if (concatTemp) await safeUnlink(concatTemp);
    if (mixedTemp) await safeUnlink(mixedTemp);
  }
}

export class ExportDuplicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportDuplicateError";
  }
}
