import { DashboardShell } from "@/components/layout/DashboardShell";
import { CampaignSettings } from "@/components/campaign/CampaignSettings";

export default function CampaignSettingsPage() {
  return (
    <DashboardShell
      header={
        <div>
          <h1 className="font-display text-lg font-semibold tracking-tight sm:text-xl">
            Campaign settings
          </h1>
          <p className="text-xs text-muted sm:text-sm">
            Hooks, demos, captions, and audio for the active campaign
          </p>
        </div>
      }
    >
      <CampaignSettings />
    </DashboardShell>
  );
}
