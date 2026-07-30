import { DashboardShell } from "@/components/layout/DashboardShell";
import { YouTubeScheduler } from "@/components/youtube/YouTubeScheduler";

export default function YouTubePage() {
  return (
    <DashboardShell
      header={
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-lg font-semibold tracking-tight sm:text-xl">
              YouTube
            </h1>
            <p className="text-xs text-muted sm:text-sm">
              Set posting goals, fill calendar slots, or bulk schedule Shorts
            </p>
          </div>
        </div>
      }
    >
      <div className="mx-auto max-w-6xl">
        <YouTubeScheduler />
      </div>
    </DashboardShell>
  );
}
