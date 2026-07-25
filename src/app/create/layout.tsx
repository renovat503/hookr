import { DashboardShell } from "@/components/layout/DashboardShell";
import { ProjectProvider } from "@/components/providers/ProjectProvider";

export default function CreateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProjectProvider>
      <DashboardShell
        header={
          <div>
            <h1 className="font-display text-lg font-semibold tracking-tight sm:text-xl">
              Create hooks
            </h1>
            <p className="text-xs text-muted sm:text-sm">
              Generate 4-second hook clips with text overlay — saved to your library
            </p>
          </div>
        }
      >
        {children}
      </DashboardShell>
    </ProjectProvider>
  );
}
