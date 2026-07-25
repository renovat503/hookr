import { DashboardShell } from "@/components/layout/DashboardShell";
import { InstagramScheduler } from "@/components/instagram/InstagramScheduler";

export default function InstagramPage() {
  return (
    <DashboardShell
      header={
        <div>
          <h1 className="font-display text-lg font-semibold tracking-tight sm:text-xl">
            Instagram
          </h1>
          <p className="text-xs text-muted sm:text-sm">
            Connect accounts and schedule finished Reels
          </p>
        </div>
      }
    >
      <div className="mx-auto max-w-5xl">
        <InstagramScheduler />
      </div>
    </DashboardShell>
  );
}
