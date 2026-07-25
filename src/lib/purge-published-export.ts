import { purgeExportFromInstagram } from "@/lib/instagram-store";
import { removeLibraryItem } from "@/lib/library-store";
import { deleteMedia } from "@/lib/storage/media";

/** Remove a finished export from storage, library, and all Instagram records. */
export async function purgePublishedExport(
  exportId: string,
  exportUrl: string | null | undefined,
): Promise<void> {
  if (exportUrl) {
    try {
      await deleteMedia(exportUrl);
    } catch (err) {
      console.error("[purge] media delete failed", exportId, err);
    }
  }

  await purgeExportFromInstagram(exportId);

  try {
    await removeLibraryItem("exports", exportId);
  } catch (err) {
    console.error("[purge] library remove failed", exportId, err);
    throw err;
  }
}
