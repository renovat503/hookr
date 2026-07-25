import { DashboardShell } from "@/components/layout/DashboardShell";
import { MediaLibrary } from "@/components/library/MediaLibrary";

type LibraryPageProps = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const params = await searchParams;
  const initialTab =
    params.tab === "captions"
      ? ("captions" as const)
      : params.tab === "exports"
        ? ("exports" as const)
        : params.tab === "hooks" ||
          params.tab === "demos" ||
          params.tab === "motions" ||
          params.tab === "music"
        ? params.tab
        : "hooks";

  return (
    <DashboardShell
      header={
        <div>
          <h1 className="font-display text-lg font-semibold tracking-tight sm:text-xl">
            Media library
          </h1>
          <p className="text-xs text-muted sm:text-sm">
            Hooks, demos, motions, music, and captions
          </p>
        </div>
      }
    >
      <div className="mx-auto max-w-6xl">
        <MediaLibrary initialTab={initialTab} showCaptionsTab />
      </div>
    </DashboardShell>
  );
}
