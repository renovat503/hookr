const DEFAULT_MAX_UPLOAD_MB = 48;

export function getMaxUploadBytes(): number {
  const raw = process.env.SUPABASE_MAX_UPLOAD_MB?.trim();
  const mb = raw ? Number(raw) : DEFAULT_MAX_UPLOAD_MB;
  if (!Number.isFinite(mb) || mb <= 0) {
    return DEFAULT_MAX_UPLOAD_MB * 1024 * 1024;
  }
  return Math.round(mb * 1024 * 1024);
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isSupabaseSizeLimitError(message: string): boolean {
  return /maximum allowed size|file_size_limit|payload too large|413/i.test(message);
}

export function supabaseSizeLimitMessage(fileBytes: number): string {
  const limit = getMaxUploadBytes();
  return (
    `This video is ${formatMegabytes(fileBytes)}, but Supabase allows up to ${formatMegabytes(limit)} on your plan. ` +
    "The app tried to compress it automatically — if you still see this, trim the clip or raise the global limit in Supabase → Storage → Settings (Pro plan required above 50 MB)."
  );
}
