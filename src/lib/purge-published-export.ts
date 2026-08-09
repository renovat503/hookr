/**
 * Post-publish retention: finished exports stay in the library and storage
 * so they can be re-scheduled or recovered. Soft-cancel of schedules is fine;
 * do not delete export rows or media after a successful publish.
 *
 * See `.cursor/rules/no-hard-deletes.mdc`.
 */

/** @deprecated Kept for call-site compatibility; retention mode is a no-op. */
export async function purgePublishedExportIfUnused(
  _exportId: string,
  _exportUrl: string | null | undefined,
): Promise<void> {
  // Intentionally retain exports after publish.
}

/** @deprecated Kept for call-site compatibility; retention mode is a no-op. */
export async function purgePublishedExport(
  exportId: string,
  exportUrl: string | null | undefined,
): Promise<void> {
  await purgePublishedExportIfUnused(exportId, exportUrl);
}
