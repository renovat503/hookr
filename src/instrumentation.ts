export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getDataMode, getMediaMode, isCloudConfigured } = await import(
    "./lib/config/storage-mode"
  );
  console.log(
    `[hookr] data=${getDataMode()} media=${getMediaMode()} cloud=${isCloudConfigured()}`,
  );
  if (process.env.NODE_ENV === "production") {
    if (getDataMode() === "off") {
      console.warn(
        "[hookr] HOOKR_DATA_MODE=off in production — metadata will not persist across deploys. Set HOOKR_DATA_MODE=dual-write (or postgres-only) and DATABASE_URL.",
      );
    }
    if (getMediaMode() === "local") {
      console.warn(
        "[hookr] HOOKR_MEDIA_MODE=local in production — uploads will not persist. Set HOOKR_MEDIA_MODE=dual-write (or supabase-only) with Supabase env vars.",
      );
    }
  }

  const { ensureInstagramMeta } = await import("./lib/db/ensure-instagram-meta");
  void ensureInstagramMeta();

  const { processInstagramDue } = await import("./lib/process-instagram-due");

  const tick = () => {
    void processInstagramDue().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      const cause =
        err instanceof Error && err.cause instanceof Error
          ? err.cause.message
          : null;
      console.error(
        "[hookr/auto-post]",
        cause ? `${message} (${cause})` : message,
      );
    });
  };

  // First run shortly after server boot, then every minute.
  setTimeout(tick, 8_000);
  setInterval(tick, 60_000);
}
