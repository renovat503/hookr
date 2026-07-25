import { mkdir, writeFile } from "fs/promises";
import path from "path";

function resolvePublicMediaBase(): string | null {
  const raw =
    process.env.INSTAGRAM_MEDIA_BASE_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "";
  if (!raw) return null;

  const base = raw.replace(/#.*$/, "").trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(base)) return null;
  if (/localhost|127\.0\.0\.1/i.test(base)) return null;
  return base;
}

/** Save a character image where Kling Turbo can fetch it via public HTTPS URL. */
export async function publishKlingReferenceImage(options: {
  imageBase64: string;
  mimeType?: string | null;
  stamp: number;
}): Promise<string | null> {
  const base = resolvePublicMediaBase();
  if (!base) return null;

  const ext =
    options.mimeType?.includes("png")
      ? "png"
      : options.mimeType?.includes("webp")
        ? "webp"
        : "jpg";
  const filename = `kling-ref-${options.stamp}.${ext}`;
  const dir = path.join(process.cwd(), "public", "generated");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, filename),
    Buffer.from(options.imageBase64, "base64"),
  );

  return `${base}/generated/${filename}`;
}
