import { Sidebar } from "./Sidebar";
import { AutoPostTicker } from "@/components/instagram/AutoPostTicker";

export function DashboardShell({
  children,
  header,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
}) {
  return (
    <div className="relative z-10 flex min-h-dvh">
      <AutoPostTicker />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {header && (
          <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-border-subtle bg-background/80 px-6 py-4 backdrop-blur-xl">
            {header}
          </header>
        )}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
