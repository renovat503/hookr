import { access, mkdir, unlink, writeFile, copyFile, stat } from "fs/promises";
import { spawn } from "child_process";
import os from "os";
import path from "path";
import { constants as fsConstants } from "fs";
import type { OverlayStyle, ExportVariation } from "./types";
import { DEFAULT_OVERLAY_STYLE, DEFAULT_MUSIC_VOLUME } from "./constants";
import { CAPTION_FRAME } from "./caption-frame";

function resolveFfmpegBin(): string {
  // Prefer the bundled binary (includes drawtext). System Homebrew ffmpeg often does not.
  const bundled = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "node_modules",
    "ffmpeg-static",
    "ffmpeg",
  );
  try {
    // Sync check without dynamic require so Turbopack doesn't NFT the whole tree
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    if (fs.existsSync(bundled)) return bundled;
  } catch {
    // fall through
  }
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  throw new Error(
    "ffmpeg-static not found. Run npm install ffmpeg-static (needed for text overlays).",
  );
}

const FFMPEG = resolveFfmpegBin();

async function fileExists(p: string) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const BUNDLED_FONTS_DIR = path.join(
  process.cwd(),
  "public",
  "fonts",
);

function bundledFont(name: string) {
  return path.join(BUNDLED_FONTS_DIR, name);
}

export async function resolveFontFile(
  style: OverlayStyle["fontFamily"] = "impact",
  bold = true,
): Promise<string> {
  const bundled = [
    bundledFont("BricolageGrotesque-Variable.ttf"),
    bundledFont("DejaVuSans-Bold.ttf"),
    bundledFont("DejaVuSans.ttf"),
  ];

  const boldArial = [
    bundledFont("Arial-Bold.ttf"),
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ];
  const regularArial = [
    bundledFont("Arial.ttf"),
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];

  const map: Record<OverlayStyle["fontFamily"], string[]> = {
    impact: [
      "/System/Library/Fonts/Supplemental/Impact.ttf",
      "/Library/Fonts/Impact.ttf",
      "/System/Library/Fonts/Supplemental/Arial Black.ttf",
      ...boldArial,
    ],
    "arial-black": [
      "/System/Library/Fonts/Supplemental/Arial Black.ttf",
      "/Library/Fonts/Arial Black.ttf",
      ...boldArial,
    ],
    arial: bold ? boldArial : regularArial,
    helvetica: [
      "/System/Library/Fonts/Helvetica.ttc",
      "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
      ...(bold ? boldArial : regularArial),
    ],
    georgia: [
      "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
      "/System/Library/Fonts/Supplemental/Georgia.ttf",
      "/Library/Fonts/Georgia.ttf",
      ...(bold ? boldArial : regularArial),
    ],
    times: [
      "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
      "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
      ...(bold ? boldArial : regularArial),
    ],
    courier: [
      "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
      "/System/Library/Fonts/Supplemental/Courier New.ttf",
      ...(bold ? boldArial : regularArial),
    ],
    rounded: [
      "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf",
      ...boldArial,
    ],
    "bricolage-grotesque": [
      bundledFont("BricolageGrotesque-Variable.ttf"),
      ...(bold ? boldArial : regularArial),
    ],
  };

  const candidates = [
    ...bundled,
    ...(map[style] ?? boldArial),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  throw new Error(
    "No usable font found for text overlays. Bundled fonts are missing from public/fonts.",
  );
}

function escapeFilterPath(filePath: string) {
  // Escape characters that break FFmpeg filtergraphs
  return filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,");
}

function escapeFilterColor(color: string) {
  // `@` names filter instances in filtergraphs — must be escaped in values
  return color.replace(/@/g, "\\@");
}

function toFfmpegColor(color: string) {
  if (color.startsWith("#")) return `0x${color.slice(1)}`;
  return color;
}

function wrapCaption(text: string, maxChars = 22): string {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4).join("\n");
}

const DEFAULT_VERTICAL = {
  width: CAPTION_FRAME.width,
  height: CAPTION_FRAME.height,
};

/** Scale + center-crop to the reel caption canvas (9:16) without distortion. */
export function reelCoverScaleCropFilter(
  width = CAPTION_FRAME.width,
  height = CAPTION_FRAME.height,
) {
  const w = evenDimension(width);
  const h = evenDimension(height);
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
}

/** Normalize hook/demo clips to the caption design frame (1080×1920). */
export async function normalizeToReelFrame(options: {
  inputPath: string;
  outputPath: string;
}): Promise<void> {
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  const hasAudio = await hasAudioStream(options.inputPath);
  await runFfmpeg([
    "-i",
    options.inputPath,
    "-vf",
    reelCoverScaleCropFilter(),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]),
    "-movflags",
    "+faststart",
    options.outputPath,
  ]);
}

function evenDimension(value: number) {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function workTmpDir() {
  const base =
    process.env.NODE_ENV === "production"
      ? path.join(os.tmpdir(), "hookr")
      : path.join(process.cwd(), "tmp");
  return base;
}

export function hookrTmpDir() {
  return workTmpDir();
}

function isLibx264Noise(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return (
    trimmed.startsWith("libx264 @") ||
    trimmed.includes("using cpu capabilities") ||
    trimmed.includes("profile ") ||
    trimmed.includes("264 - core") ||
    trimmed.includes("kb/s:") ||
    trimmed.startsWith("frame=") ||
    trimmed.startsWith("Output #") ||
    trimmed.startsWith("Input #") ||
    trimmed.startsWith("Stream #") ||
    trimmed.startsWith("Stream mapping:") ||
    trimmed.startsWith("Metadata:") ||
    trimmed.startsWith("major_brand") ||
    trimmed.startsWith("minor_version") ||
    trimmed.startsWith("compatible_brands") ||
    trimmed.startsWith("encoder:") ||
    trimmed.startsWith("Side data:") ||
    trimmed.startsWith("cpb:") ||
    trimmed.startsWith("Press [q]") ||
    /^mb [IP]/.test(trimmed) ||
    /^coded y/u.test(trimmed) ||
    /^i\d+ v,h,dc,p:/.test(trimmed)
  );
}

function extractFfmpegError(stderr: string) {
  const lines = stderr.split(/\r?\n/);
  const markers = [
    "Error parsing",
    "Error applying option",
    "Error while",
    "Error opening",
    "No such filter",
    "Conversion failed",
    "Invalid argument",
    "No option name",
    "Cannot",
    "failed",
    "Permission denied",
    "No such file",
    "Decoder",
    "Invalid data",
  ];
  const hits = lines.filter(
    (line) =>
      !isLibx264Noise(line) &&
      (markers.some((marker) => line.includes(marker)) ||
        /\berror\b/i.test(line)),
  );
  if (hits.length > 0) {
    return [...new Set(hits)].join("\n").slice(-1200);
  }
  const useful = lines.filter((line) => !isLibx264Noise(line) && line.trim());
  if (useful.length > 0) {
    return useful.slice(-8).join("\n").slice(-1200);
  }
  return (
    "Video encoding failed on the server (often out of memory). Try again or use a shorter clip."
  );
}

function ffmpegPreset() {
  return process.env.NODE_ENV === "production" ? "ultrafast" : "veryfast";
}
function fitScalePadFilter(
  width: number,
  height: number,
  scaleFlags = "lanczos",
) {
  const w = evenDimension(width);
  const h = evenDimension(height);
  const flagsPart = scaleFlags ? `:flags=${scaleFlags}` : "";
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease${flagsPart},pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
}

export async function getVideoDimensions(
  filePath: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-i", filePath, "-hide_banner"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("close", () => {
      const match = stderr.match(/Video:.*? (\d{2,5})x(\d{2,5})/);
      if (!match) {
        reject(new Error("Could not read video dimensions."));
        return;
      }
      resolve({
        width: evenDimension(Number(match[1])),
        height: evenDimension(Number(match[2])),
      });
    });
    child.on("error", reject);
  });
}

export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      FFMPEG,
      ["-hide_banner", "-loglevel", "warning", "-y", ...args],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal === "SIGKILL" || signal === "SIGTERM") {
        reject(
          new Error(
            "Video encoding was interrupted on the server (likely out of memory). Try again with a shorter clip.",
          ),
        );
        return;
      }
      console.error("[ffmpeg]", extractFfmpegError(stderr), "\n--- stderr ---\n", stderr.slice(-4000));
      reject(new Error(extractFfmpegError(stderr) || `ffmpeg exited ${code}`));
    });
  });
}

async function assertReadableMedia(filePath: string, label: string) {
  if (!(await fileExists(filePath))) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  const { size } = await import("fs/promises").then((fs) => fs.stat(filePath));
  if (size < 1024) {
    throw new Error(`${label} is too small (${size} bytes): ${filePath}`);
  }
}

function assertValidPngBuffer(buffer: Buffer) {
  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  if (!isPng) {
    throw new Error(
      "Caption image is invalid — refresh the page and try Apply caption again.",
    );
  }
}

export async function assertValidVideoFile(filePath: string, label = "Video") {
  await assertReadableMedia(filePath, label);
  try {
    await getMediaDurationSeconds(filePath);
  } catch {
    throw new Error(`${label} file is corrupt or unreadable: ${filePath}`);
  }
}

export async function overlayPngOntoVideo(options: {
  inputPath: string;
  outputPath: string;
  overlayPngBase64: string;
}): Promise<void> {
  const pngBuffer = Buffer.from(options.overlayPngBase64, "base64");
  if (pngBuffer.length < 256) {
    throw new Error("Caption PNG is empty — refresh and try Apply caption again.");
  }
  assertValidPngBuffer(pngBuffer);

  await assertValidVideoFile(options.inputPath, "Input video");

  const tmpDir = workTmpDir();
  await mkdir(tmpDir, { recursive: true });
  await mkdir(path.dirname(options.outputPath), { recursive: true });

  const pngPath = path.join(tmpDir, `overlay-${Date.now()}.png`);
  await writeFile(pngPath, pngBuffer);

  const frameW = CAPTION_FRAME.width;
  const frameH = CAPTION_FRAME.height;
  const preset = ffmpegPreset();

  try {
    const hasAudio = await hasAudioStream(options.inputPath);
    await runFfmpeg([
      "-threads",
      "2",
      "-i",
      options.inputPath,
      "-i",
      pngPath,
      "-filter_complex",
      [
        `[0:v]${reelCoverScaleCropFilter(frameW, frameH)},format=yuv420p[base]`,
        `[1:v]format=rgba[ov]`,
        `[base][ov]overlay=0:0:eof_action=pass:repeatlast=1,format=yuv420p[outv]`,
      ].join(";"),
      "-map",
      "[outv]",
      ...(hasAudio ? ["-map", "0:a?", "-c:a", "aac", "-b:a", "128k"] : ["-an"]),
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-x264-params",
      "threads=2:lookahead_threads=1",
      "-movflags",
      "+faststart",
      options.outputPath,
    ]);
    await assertReadableMedia(options.outputPath, "Output video");
  } finally {
    await safeUnlink(pngPath);
  }
}

export async function burnTextOverlay(options: {
  inputPath: string;
  outputPath: string;
  text: string;
  style?: Partial<OverlayStyle>;
  /** Optional WYSIWYG PNG (base64, no data-URL prefix) captured from the designer */
  overlayPngBase64?: string | null;
}): Promise<void> {
  await mkdir(path.dirname(options.outputPath), { recursive: true });

  if (options.overlayPngBase64) {
    await overlayPngOntoVideo({
      inputPath: options.inputPath,
      outputPath: options.outputPath,
      overlayPngBase64: options.overlayPngBase64,
    });
    return;
  }

  const style: OverlayStyle = {
    ...DEFAULT_OVERLAY_STYLE,
    ...options.style,
  };
  const fontsize = Math.max(20, Math.min(120, Math.round(style.fontSize || 48)));
  const maxChars = Math.max(14, Math.min(36, Math.round(780 / fontsize)));
  const caption = wrapCaption(
    style.uppercase ? options.text.toUpperCase() : options.text,
    maxChars,
  );

  if (!caption) {
    await copyFile(options.inputPath, options.outputPath);
    return;
  }

  const tmpDir = path.join(/* turbopackIgnore: true */ process.cwd(), "tmp");
  await mkdir(tmpDir, { recursive: true });
  const textFilePath = path.join(tmpDir, `caption-${Date.now()}.txt`);
  await writeFile(textFilePath, caption, "utf8");

  try {
    const fontfile = await resolveFontFile(style.fontFamily, style.bold);

    let yExpr = "(h-text_h)/2";
    if (style.layout === "caption-top") yExpr = "h*0.08";
    if (style.layout === "caption-bottom") yExpr = "h-text_h-h*0.12";

    let xExpr = "(w-text_w)/2";
    if (style.align === "left") xExpr = "w*0.06";
    if (style.align === "right") xExpr = "w-text_w-w*0.06";

    const fontcolor = escapeFilterColor(
      toFfmpegColor(style.textColor || "white"),
    );
    const borderw = Math.max(
      0,
      Math.min(20, Math.round(style.borderWidth ?? 0)),
    );
    const bordercolor = escapeFilterColor(
      toFfmpegColor(style.borderColor || "black"),
    );
    const boxParts = style.highlight
      ? `:box=1:boxcolor=${escapeFilterColor("black@0.75")}:boxborderw=18`
      : "";

    const safeFont = escapeFilterPath(fontfile);
    const safeTextFile = escapeFilterPath(textFilePath);
    const italicPart = style.italic ? ":fontstyle=italic" : "";
    const borderPart =
      borderw > 0 ? `:borderw=${borderw}:bordercolor=${bordercolor}` : "";

    const dims = await getVideoDimensions(options.inputPath).catch(
      () => DEFAULT_VERTICAL,
    );
    const w = evenDimension(dims.width);
    const h = evenDimension(dims.height);
    const sizeScale = w / DEFAULT_VERTICAL.width;
    const scaledFontsize = Math.max(
      20,
      Math.min(120, Math.round(fontsize * sizeScale)),
    );

    const vf = [
      `drawtext=fontfile=${safeFont}:textfile=${safeTextFile}:fontsize=${scaledFontsize}:fontcolor=${fontcolor}${borderPart}:x=${xExpr}:y=${yExpr}${boxParts}${italicPart}:line_spacing=14`,
    ].join(",");

    await runFfmpeg([
      "-i",
      options.inputPath,
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      ...(await hasAudioStream(options.inputPath)
        ? ["-c:a", "aac", "-b:a", "128k"]
        : ["-an"]),
      "-movflags",
      "+faststart",
      options.outputPath,
    ]);
  } finally {
    await safeUnlink(textFilePath);
  }
}

async function hasAudioStream(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, ["-i", filePath, "-hide_banner"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("close", () => resolve(/Stream #.+Audio:/.test(stderr)));
    child.on("error", () => resolve(false));
  });
}

export async function getMediaDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-i", filePath, "-hide_banner"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("close", () => {
      const match = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) {
        reject(new Error("Could not read media duration."));
        return;
      }
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3]);
      resolve(hours * 3600 + minutes * 60 + seconds);
    });
    child.on("error", reject);
  });
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 1 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng: () => number, min: number, max: number) {
  return min + rng() * (max - min);
}

type InternalExportVariation = ExportVariation & {
  cropPx: number;
  brightness: number;
  contrast: number;
  saturation: number;
  crf: number;
};

export function createExportVariation(
  seed: number,
  withMusic = false,
): InternalExportVariation {
  const rng = mulberry32(seed);
  return {
    seed,
    speed: Number(randRange(rng, 0.985, 1.015).toFixed(4)),
    trimStartMs: Math.round(randRange(rng, 0, 120)),
    trimEndMs: Math.round(randRange(rng, 0, 120)),
    cropPx: Math.round(randRange(rng, 2, 6)),
    brightness: Number(randRange(rng, -0.03, 0.03).toFixed(4)),
    contrast: Number(randRange(rng, 0.97, 1.03).toFixed(4)),
    saturation: Number(randRange(rng, 0.97, 1.03).toFixed(4)),
    crf: Math.round(randRange(rng, 19, 21)),
    ...(withMusic
      ? { musicStartOffsetSec: Number(randRange(rng, 0, 3).toFixed(2)) }
      : {}),
  };
}

export async function uniqueifyExportVideo(options: {
  inputPath: string;
  outputPath: string;
  variation: InternalExportVariation;
}): Promise<void> {
  await mkdir(path.dirname(options.outputPath), { recursive: true });

  const duration = await getMediaDurationSeconds(options.inputPath);
  const dims = await getVideoDimensions(options.inputPath).catch(
    () => DEFAULT_VERTICAL,
  );
  const outW = evenDimension(dims.width);
  const outH = evenDimension(dims.height);
  const startSec = options.variation.trimStartMs / 1000;
  const endSec = Math.max(
    startSec + 0.5,
    duration - options.variation.trimEndMs / 1000,
  );
  const speed = options.variation.speed;
  const crop = options.variation.cropPx;
  const { brightness, contrast, saturation, crf } = options.variation;
  const hasAudio = await hasAudioStream(options.inputPath);

  const videoFilter = [
    `[0:v]trim=start=${startSec.toFixed(3)}:end=${endSec.toFixed(3)},setpts=PTS-STARTPTS`,
    `setpts=PTS/${speed.toFixed(4)}`,
    `crop=iw-${crop * 2}:ih-${crop * 2}:${crop}:${crop}`,
    fitScalePadFilter(outW, outH),
    `eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`,
    "format=yuv420p[v]",
  ].join(",");

  if (hasAudio) {
    const audioFilter = [
      `[0:a]atrim=start=${startSec.toFixed(3)}:end=${endSec.toFixed(3)},asetpts=PTS-STARTPTS`,
      `atempo=${speed.toFixed(4)}[a]`,
    ].join(",");
    await runFfmpeg([
      "-i",
      options.inputPath,
      "-filter_complex",
      `${videoFilter};${audioFilter}`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      String(crf),
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-map_metadata",
      "-1",
      "-movflags",
      "+faststart",
      options.outputPath,
    ]);
    return;
  }

  await runFfmpeg([
    "-i",
    options.inputPath,
    "-filter_complex",
    videoFilter,
    "-map",
    "[v]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    String(crf),
    "-an",
    "-map_metadata",
    "-1",
    "-movflags",
    "+faststart",
    options.outputPath,
  ]);
}

export async function mixBackgroundMusic(options: {
  videoPath: string;
  musicPath: string;
  outputPath: string;
  /** 0–1, default 0.3 */
  musicVolume?: number;
  /** 0–1, default 1 */
  videoVolume?: number;
  /** Seconds into the track before looping/trimming */
  musicStartOffsetSeconds?: number;
}): Promise<void> {
  await mkdir(path.dirname(options.outputPath), { recursive: true });

  const musicVol = options.musicVolume ?? DEFAULT_MUSIC_VOLUME / 100;
  const videoVol = options.videoVolume ?? 1;
  const duration = await getMediaDurationSeconds(options.videoPath);
  const videoHasAudio = await hasAudioStream(options.videoPath);
  const musicStart = Math.max(0, options.musicStartOffsetSeconds ?? 0);
  const trimMusic =
    musicStart > 0
      ? `[1:a]atrim=start=${musicStart.toFixed(3)},asetpts=PTS-STARTPTS,atrim=0:${duration.toFixed(3)},volume=${musicVol}[bgm]`
      : `[1:a]atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS,volume=${musicVol}[bgm]`;

  if (videoHasAudio) {
    const filter = `${trimMusic};[0:a]volume=${videoVol}[va];[va][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`;
    await runFfmpeg([
      "-i",
      options.videoPath,
      "-stream_loop",
      "-1",
      "-i",
      options.musicPath,
      "-filter_complex",
      filter,
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-shortest",
      options.outputPath,
    ]);
    return;
  }

  await runFfmpeg([
    "-i",
    options.videoPath,
    "-stream_loop",
    "-1",
    "-i",
    options.musicPath,
    "-filter_complex",
    trimMusic,
    "-map",
    "0:v",
    "-map",
    "[bgm]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-shortest",
    options.outputPath,
  ]);
}

export async function concatenateClips(options: {
  hookPath: string;
  demoPath: string;
  outputPath: string;
}): Promise<void> {
  await mkdir(path.dirname(options.outputPath), { recursive: true });

  const hookHasAudio = await hasAudioStream(options.hookPath);
  const demoHasAudio = await hasAudioStream(options.demoPath);
  const { width, height } = await getVideoDimensions(options.hookPath).catch(
    () => DEFAULT_VERTICAL,
  );
  const w = evenDimension(width);
  const h = evenDimension(height);
  const hookFit = "fps=30,format=yuv420p,setpts=PTS-STARTPTS";
  const demoFit = `${fitScalePadFilter(w, h)},fps=30,format=yuv420p,setpts=PTS-STARTPTS`;

  const v0 = `[0:v]${hookFit}[v0]`;
  const v1 = `[1:v]${demoFit}[v1]`;

  if (hookHasAudio && demoHasAudio) {
    const filter = [
      v0,
      v1,
      "[0:a]aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,asetpts=PTS-STARTPTS[a0]",
      "[1:a]aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,asetpts=PTS-STARTPTS[a1]",
      "[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]",
    ].join(";");

    await runFfmpeg([
      "-i",
      options.hookPath,
      "-i",
      options.demoPath,
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      options.outputPath,
    ]);
    return;
  }

  const filter = `${v0};${v1};[v0][v1]concat=n=2:v=1:a=0[v]`;
  await runFfmpeg([
    "-i",
    options.hookPath,
    "-i",
    options.demoPath,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-an",
    "-movflags",
    "+faststart",
    options.outputPath,
  ]);
}

export async function stripAudioFromVideo(options: {
  inputPath: string;
  outputPath: string;
}): Promise<void> {
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await runFfmpeg([
    "-i",
    options.inputPath,
    "-c:v",
    "copy",
    "-an",
    "-movflags",
    "+faststart",
    options.outputPath,
  ]);
}

/** Re-encode a demo clip until it fits under a storage upload limit. */
export async function compressVideoForStorage(options: {
  inputPath: string;
  outputPath: string;
  maxBytes: number;
}): Promise<void> {
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  const { size: inputBytes } = await stat(options.inputPath);
  const hasAudio = await hasAudioStream(options.inputPath);
  const attempts =
    inputBytes > 150 * 1024 * 1024
      ? [
          { height: 480, crf: 34, audioKbps: 48 },
          { height: 360, crf: 36, audioKbps: 48 },
        ]
      : inputBytes > 80 * 1024 * 1024
        ? [
            { height: 720, crf: 30, audioKbps: 64 },
            { height: 480, crf: 32, audioKbps: 64 },
          ]
        : [
            { height: 720, crf: 28, audioKbps: 96 },
            { height: 480, crf: 32, audioKbps: 64 },
          ];

  for (const attempt of attempts) {
    const h = evenDimension(attempt.height);
    const scale = `scale=-2:${h}:force_original_aspect_ratio=decrease,setsar=1`;
    await runFfmpeg([
      "-threads",
      "1",
      "-i",
      options.inputPath,
      "-vf",
      scale,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      String(attempt.crf),
      "-x264-params",
      "ref=1:rc-lookahead=0:threads=1",
      ...(hasAudio
        ? ["-c:a", "aac", "-b:a", `${attempt.audioKbps}k`]
        : ["-an"]),
      "-movflags",
      "+faststart",
      options.outputPath,
    ]);

    const { size } = await stat(options.outputPath);
    if (size > 0 && size <= options.maxBytes) {
      return;
    }
  }

  const { size } = await stat(options.outputPath).catch(() => ({ size: 0 }));
  throw new Error(
    size > 0
      ? `Could not compress video below ${Math.round(options.maxBytes / (1024 * 1024))} MB (still ${Math.round(size / (1024 * 1024))} MB). Trim the clip to under 2 minutes or export a smaller MP4 first.`
      : "Could not compress video for upload.",
  );
}

export function publicUrlToPath(publicUrl: string): string {
  return path.join(process.cwd(), "public", publicUrl.replace(/^\//, ""));
}

export async function writeTempBuffer(
  prefix: string,
  ext: string,
  buffer: Buffer,
): Promise<string> {
  const dir = path.join(process.cwd(), "tmp");
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `${prefix}-${Date.now()}${ext}`);
  await writeFile(tempPath, buffer);
  return tempPath;
}

export async function safeUnlink(filePath: string) {
  try {
    await unlink(filePath);
  } catch {
    // ignore
  }
}

export function getFfmpegPath() {
  return FFMPEG;
}
