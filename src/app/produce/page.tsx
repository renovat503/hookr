import { DashboardShell } from "@/components/layout/DashboardShell";
import { ProduceRunner } from "@/components/produce/ProduceRunner";

export default function ProducePage() {
  return (
    <DashboardShell
      header={
        <div>
          <h1 className="font-display text-lg font-semibold tracking-tight sm:text-xl">
            Produce
          </h1>
          <p className="text-xs text-muted sm:text-sm">
            Batch export hook × caption × demo combos — saved to disk for manual posting
          </p>
        </div>
      }
    >
      <div className="mx-auto max-w-6xl">
        <ProduceRunner />
      </div>
    </DashboardShell>
  );
}
