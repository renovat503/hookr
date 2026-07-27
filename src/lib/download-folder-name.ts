/** Timestamped folder name for a download batch, e.g. hookr-exports-2026-07-26-183900 */
export function createDownloadFolderName(prefix = "hookr-exports"): string {
  const d = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
