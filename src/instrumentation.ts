export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { processInstagramDue } = await import("./lib/process-instagram-due");

  const tick = () => {
    void processInstagramDue().catch((err) => {
      console.error("[hookr/auto-post]", err);
    });
  };

  // First run shortly after server boot, then every minute.
  setTimeout(tick, 8_000);
  setInterval(tick, 60_000);
}
