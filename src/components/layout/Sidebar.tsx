"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Clapperboard,
  Film,
  FolderKanban,
  FolderOpen,
  Layers,
  LogOut,
  Share2,
  Sparkles,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import type { Campaign } from "@/lib/types";
import { isCampaignClosed } from "@/lib/campaign-status";

const NAV = [
  {
    href: "/create",
    label: "Create hooks",
    icon: Sparkles,
    match: (p: string) => p.startsWith("/create"),
  },
  {
    href: "/produce",
    label: "Produce",
    icon: Layers,
    match: (p: string) => p.startsWith("/produce"),
  },
  {
    href: "/library",
    label: "Library",
    icon: FolderOpen,
    match: (p: string) => p.startsWith("/library"),
  },
  {
    href: "/instagram",
    label: "Instagram",
    icon: Share2,
    match: (p: string) => p.startsWith("/instagram"),
  },
  {
    href: "/youtube",
    label: "YouTube",
    icon: Video,
    match: (p: string) => p.startsWith("/youtube"),
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);

  useEffect(() => {
    void fetch("/api/campaigns")
      .then((r) => r.json())
      .then(
        (json: {
          campaigns?: Campaign[];
          activeId?: string | null;
          activeCampaign?: Campaign | null;
        }) => {
          if (json.activeCampaign) {
            setCampaign(json.activeCampaign);
            return;
          }
          const active = json.activeId
            ? json.campaigns?.find((c) => c.id === json.activeId) ?? null
            : null;
          setCampaign(active);
        },
      )
      .catch(() => undefined);
  }, [pathname]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <aside className="relative z-10 flex w-56 shrink-0 flex-col border-r border-border-subtle bg-surface/80 backdrop-blur-xl">
      <div className="flex items-center gap-2.5 px-5 py-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg shadow-[0_0_24px_var(--glow)]">
          <Clapperboard className="h-4.5 w-4.5" strokeWidth={2.25} />
        </div>
        <div>
          <p className="font-display text-lg font-bold tracking-tight leading-none">{APP_NAME}</p>
          <p className="mt-0.5 text-[11px] text-muted">Viral short-form studio</p>
        </div>
      </div>

      <div className="mx-3 mb-2 rounded-xl border border-border-subtle bg-surface-raised/60 p-3">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted">
          <FolderKanban className="h-3.5 w-3.5" />
          Campaign
        </div>
        <p className="truncate font-display text-sm font-semibold">
          {campaign?.name ?? "None selected"}
        </p>
        {campaign && isCampaignClosed(campaign) ? (
          <p className="mt-0.5 text-[11px] font-medium text-muted">Closed</p>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          <Link
            href="/campaign/settings"
            className="text-[11px] text-accent hover:underline"
          >
            Settings
          </Link>
          <Link
            href="/campaigns"
            className="text-[11px] text-muted hover:text-accent hover:underline"
          >
            Switch
          </Link>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-surface-raised text-foreground"
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 transition-colors",
                  active ? "text-accent" : "text-muted group-hover:text-foreground",
                )}
              />
              {label}
              {active && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="m-3 space-y-2">
        <div className="rounded-xl border border-border-subtle bg-surface-raised/60 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
            <Film className="h-3.5 w-3.5" />
            Output format
          </div>
          <p className="font-display text-sm font-semibold">9:16 · Vertical MP4</p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border-subtle py-2 text-xs font-medium text-muted hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
          Log out
        </button>
      </div>
    </aside>
  );
}
