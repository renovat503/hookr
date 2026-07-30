import { readInstagramAll, purgeExportFromInstagram } from "@/lib/instagram-store";
import { readYouTubeAll, purgeExportFromYouTube } from "@/lib/youtube-store";
import { removeLibraryItem } from "@/lib/library-store";
import { deleteMedia } from "@/lib/storage/media";

async function exportStillReservedElsewhere(exportId: string): Promise<boolean> {
  const [instagram, youtube] = await Promise.all([
    readInstagramAll(),
    readYouTubeAll(),
  ]);

  for (const post of [...instagram.scheduledPosts, ...youtube.scheduledPosts]) {
    if (post.exportId !== exportId) continue;
    if (
      post.status === "queued" ||
      post.status === "scheduled" ||
      post.status === "publishing"
    ) {
      return true;
    }
  }
  return false;
}

/** Remove export only when no platform still has it queued or scheduled. */
export async function purgePublishedExportIfUnused(
  exportId: string,
  exportUrl: string | null | undefined,
): Promise<void> {
  if (await exportStillReservedElsewhere(exportId)) {
    return;
  }

  if (exportUrl) {
    try {
      await deleteMedia(exportUrl);
    } catch (err) {
      console.error("[purge] media delete failed", exportId, err);
    }
  }

  await Promise.all([
    purgeExportFromInstagram(exportId),
    purgeExportFromYouTube(exportId),
  ]);

  try {
    await removeLibraryItem("exports", exportId);
  } catch (err) {
    console.error("[purge] library remove failed", exportId, err);
    throw err;
  }
}

/** Remove a finished export from storage, library, and all platform records. */
export async function purgePublishedExport(
  exportId: string,
  exportUrl: string | null | undefined,
): Promise<void> {
  await purgePublishedExportIfUnused(exportId, exportUrl);
}
