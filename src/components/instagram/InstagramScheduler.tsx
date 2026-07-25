"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Link2,
  Loader2,
  Send,
  Share2,
  Timer,
  Trash2,
  Unplug,
  XCircle,
} from "lucide-react";
import { ReelPlayer, reelFrameClass } from "@/components/ui/ReelPlayer";
import type { LibraryExport, ScheduledPost } from "@/lib/types";
import { cn } from "@/lib/utils";

type PublicAccount = {
  id: string;
  igUserId: string;
  username: string;
  profilePictureUrl?: string | null;
  pageId: string;
  pageName: string;
  connectedAt: string;
  tokenExpiresAt?: string | null;
};

type AutoPostAccountStatus = {
  id: string;
  username: string;
  lastPublishedAt: string | null;
  nextEligibleAt: string | null;
  canPostNow: boolean;
};

type InstagramPayload = {
  configured: boolean;
  redirectUri: string;
  canPublishMedia?: boolean;
  mediaBaseUrl?: string | null;
  accounts: PublicAccount[];
  scheduledPosts: ScheduledPost[];
  exports: LibraryExport[];
  autoPost?: {
    enabled: boolean;
    intervalHours?: 4 | 5 | 6;
    intervalOptions?: Array<4 | 5 | 6>;
    intervalMs?: number;
    intervalLabel?: string;
    unpublishedCount: number;
    next?: {
      exportId: string | null;
      exportName: string | null;
      postsAt: string | null;
      eligibleNow: boolean;
    };
    accounts: AutoPostAccountStatus[];
    rateLimitedUntil?: string | null;
    rateLimitedNow?: boolean;
  };
};

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** mm:ss (or hh:mm:ss) countdown until auto-post */
function formatPostCountdown(
  postsAt: string | null,
  eligibleNow: boolean,
  nowMs: number,
) {
  if (eligibleNow) {
    const untilTick = Math.ceil(nowMs / 60_000) * 60_000 - nowMs;
    const secs = Math.max(0, Math.ceil(untilTick / 1000));
    return { label: "Next check", value: `0:${String(secs).padStart(2, "0")}` };
  }
  if (!postsAt) return { label: "Posts in", value: "—" };
  const diffMs = new Date(postsAt).getTime() - nowMs;
  if (diffMs <= 0) return { label: "Posts in", value: "soon" };
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const mins = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  const secs = Math.floor((diffMs % (60 * 1000)) / 1000);
  const value =
    hours > 0
      ? `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return { label: "Posts in", value };
}

export function InstagramScheduler() {
  const [data, setData] = useState<InstagramPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [accountId, setAccountId] = useState("");
  const [exportId, setExportId] = useState("");
  const [caption, setCaption] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    return toLocalInputValue(d);
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/instagram", {
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await res.json()) as InstagramPayload & { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not load Instagram.");
      setData(json);
      setAccountId((current) => current || json.accounts[0]?.id || "");
      setExportId((current) => {
        if (current && json.exports.some((e) => e.id === current)) {
          return current;
        }
        return json.exports[0]?.id || "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const oauthError = params.get("error");
    if (connected) {
      setNotice(
        `Connected ${connected} Instagram account${connected === "1" ? "" : "s"}.`,
      );
    }
    if (oauthError) setError(oauthError);
    if (connected || oauthError) {
      window.history.replaceState({}, "", "/instagram");
    }
    void load();
  }, [load]);

  useEffect(() => {
    if (!data?.autoPost?.enabled) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [data?.autoPost?.enabled]);

  useEffect(() => {
    const selected = data?.exports.find((e) => e.id === exportId);
    if (selected) {
      setCaption(
        [selected.overlayText, `#hookr`].filter(Boolean).join("\n\n"),
      );
    }
  }, [data?.exports, exportId]);

  // Process any due posts while this page is open
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        await fetch("/api/instagram/process-due", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!cancelled) await load();
      } catch {
        // ignore background failures
      }
    };
    void tick();
    const id = window.setInterval(tick, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [load]);

  const selectedExport = useMemo(
    () => data?.exports.find((e) => e.id === exportId) ?? null,
    [data, exportId],
  );

  const disconnect = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/instagram/accounts/disconnect?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Disconnect failed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed.");
    } finally {
      setBusy(false);
    }
  };

  const schedule = async (publishNow: boolean) => {
    if (!accountId || !exportId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/instagram/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          exportId,
          caption,
          scheduledAt: publishNow
            ? new Date().toISOString()
            : new Date(scheduledAt).toISOString(),
          publishNow,
        }),
      });
      const json = (await res.json()) as ScheduledPost & { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not schedule.");

      if (publishNow) {
        const pub = await fetch("/api/instagram/process-due", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: json.id }),
        });
        const pubJson = (await pub.json()) as {
          error?: string;
          results?: Array<{ ok: boolean; error?: string }>;
        };
        if (!pub.ok) throw new Error(pubJson.error || "Publish failed.");
        const result = pubJson.results?.[0];
        if (result && !result.ok) {
          throw new Error(result.error || "Publish failed.");
        }
        setNotice("Reel published to Instagram.");
      } else {
        setNotice(`Scheduled for ${formatWhen(json.scheduledAt)}.`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Schedule failed.");
    } finally {
      setBusy(false);
    }
  };

  const cancelPost = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/instagram/schedule/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const updateAutoPost = async (patch: {
    enabled?: boolean;
    intervalHours?: 4 | 5 | 6;
  }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/instagram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(patch.enabled !== undefined
            ? { autoPostEnabled: patch.enabled }
            : {}),
          ...(patch.intervalHours !== undefined
            ? { autoPostIntervalHours: patch.intervalHours }
            : {}),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not update auto-post.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading Instagram…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-accent">
          Social
        </p>
        <h2 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Instagram
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Connect Instagram Business or Creator accounts, schedule Reels
          manually, or let Hookr auto-post the oldest finished video every{" "}
          {data?.autoPost?.intervalLabel ?? "5 hours"} per account while this
          app is running.
        </p>
        {data ? (
          <p className="mt-2 text-sm text-muted">
            <span className="font-medium text-foreground">
              {data.exports.length}
            </span>{" "}
            finished video{data.exports.length === 1 ? "" : "s"} ready to
            schedule
            {data.exports.length === 0
              ? " — create more in Produce or view all in Library → Exports."
              : "."}
          </p>
        ) : null}
      </div>

      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-accent">
          {notice}
        </p>
      )}

      {data?.autoPost?.rateLimitedNow && data.autoPost.rateLimitedUntil && (
        <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
          Instagram rate limit reached. Auto-post is paused until{" "}
          {formatWhen(data.autoPost.rateLimitedUntil)} — the same video will
          retry automatically after that.
        </p>
      )}

      {data?.configured && data.canPublishMedia === false && (
        <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
          Publishing needs a public HTTPS video URL — Meta cannot fetch
          localhost. Set{" "}
          <code className="text-accent">INSTAGRAM_MEDIA_BASE_URL</code> to a
          tunnel that serves <code className="text-accent">/public</code> (see
          .env.local.example).
        </p>
      )}

      {!data?.configured ? (
        <section className="rounded-2xl border border-border bg-surface/70 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Share2 className="h-4 w-4 text-accent" />
            <h3 className="font-display text-lg font-semibold">
              Connect Meta app
            </h3>
          </div>
          <p className="mb-4 text-sm text-muted">
            Add these to <code className="text-foreground">.env.local</code>.
            Use the <span className="text-foreground">Instagram App ID</span>{" "}
            and <span className="text-foreground">Instagram App Secret</span>{" "}
            from Meta → Instagram → API setup with Instagram login → Business
            login settings (not the Facebook App ID unless they match).
          </p>
          <ul className="space-y-2 rounded-xl border border-border bg-surface-raised p-4 font-mono text-xs text-foreground">
            <li>INSTAGRAM_APP_ID=your_instagram_app_id</li>
            <li>INSTAGRAM_APP_SECRET=your_instagram_app_secret</li>
            <li>
              APP_URL=
              {typeof window !== "undefined"
                ? window.location.origin
                : "http://localhost:3000"}
            </li>
          </ul>
          <p className="mt-3 text-xs text-muted">
            OAuth redirect URI (exact match):{" "}
            <span className="font-mono text-foreground">
              {data?.redirectUri}
            </span>
          </p>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-border bg-surface/70 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold">Accounts</h3>
                <p className="mt-1 text-sm text-muted">
                  Professional Instagram accounts linked via Instagram Login.
                </p>
                {data.redirectUri ? (
                  <p className="mt-2 text-xs text-muted">
                    Add this exact OAuth redirect URI in Meta → Instagram → API
                    setup → Business login settings →{" "}
                    <span className="font-mono text-foreground">
                      {data.redirectUri}
                    </span>
                  </p>
                ) : null}
              </div>
              <a
                href="/api/instagram/auth"
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition-all hover:brightness-110"
              >
                <Link2 className="h-4 w-4" />
                Connect Instagram
              </a>
            </div>

            {data.accounts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
                No accounts connected yet.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {data.accounts.map((account) => (
                  <li
                    key={account.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised p-3"
                  >
                    {account.profilePictureUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={account.profilePictureUrl}
                        alt=""
                        className="h-11 w-11 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/15 text-accent">
                        <Share2 className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        @{account.username}
                      </p>
                      <p className="truncate text-[11px] text-muted">
                        via {account.pageName}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void disconnect(account.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:text-danger"
                    >
                      <Unplug className="h-3.5 w-3.5" />
                      Disconnect
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.accounts.length > 0 && data.autoPost ? (
            <section className="rounded-2xl border border-border bg-surface/70 p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Timer className="h-4 w-4 text-accent" />
                    <h3 className="font-display text-lg font-semibold">
                      Auto-post
                    </h3>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    Each account posts the oldest unpublished finished video on
                    your chosen schedule. Keep this page open (or the dev server
                    running) for automatic publishing.
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={data.autoPost.enabled}
                    disabled={busy}
                    onChange={(e) =>
                      void updateAutoPost({ enabled: e.target.checked })
                    }
                    className="accent-accent"
                  />
                  Enabled
                </label>
              </div>

              <div className="mb-4 space-y-2">
                <p className="text-xs font-medium text-muted">Post every</p>
                <div className="flex flex-wrap gap-2">
                  {(data.autoPost.intervalOptions ?? [4, 5, 6]).map(
                    (hours) => (
                      <button
                        key={hours}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void updateAutoPost({ intervalHours: hours })
                        }
                        className={cn(
                          "rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors",
                          data.autoPost?.intervalHours === hours
                            ? "bg-accent text-accent-fg shadow-[0_0_20px_var(--glow)]"
                            : "border border-border bg-surface-raised text-muted hover:text-foreground",
                        )}
                      >
                        {hours} hours
                      </button>
                    ),
                  )}
                </div>
                <p className="text-[11px] text-muted">
                  Currently set to{" "}
                  {data.autoPost.intervalLabel ?? `${data.autoPost.intervalHours ?? 5} hours`}{" "}
                  between posts per account.
                </p>
              </div>

              {data.autoPost.enabled && data.autoPost.next?.exportId && (
                <div className="mb-4 rounded-2xl border-2 border-accent/50 bg-gradient-to-r from-accent/20 via-accent/10 to-surface/80 px-5 py-4 shadow-[0_0_32px_var(--glow)]">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg">
                        <Share2 className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                          Next Reel
                        </p>
                        <p className="mt-1 truncate font-display text-lg font-bold text-foreground">
                          {data.autoPost.next.exportName || "Finished video"}
                        </p>
                      </div>
                    </div>
                    {(() => {
                      const countdown = formatPostCountdown(
                        data.autoPost.next.postsAt,
                        data.autoPost.next.eligibleNow,
                        nowMs,
                      );
                      return (
                        <div className="rounded-xl border border-accent/40 bg-accent/15 px-5 py-3 text-center">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                            {countdown.label}
                          </p>
                          <p className="font-display text-3xl font-bold tabular-nums tracking-tight text-accent">
                            {countdown.value}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              <p className="mb-3 text-xs text-muted">
                {data.autoPost.unpublishedCount} unpublished finished video
                {data.autoPost.unpublishedCount === 1 ? "" : "s"} in queue
              </p>

              <ul className="space-y-2">
                {data.autoPost.accounts.map((account) => {
                  const accountCountdown =
                    data.autoPost?.enabled &&
                    (account.canPostNow
                      ? formatPostCountdown(
                          data.autoPost.next?.postsAt ?? null,
                          true,
                          nowMs,
                        )
                      : account.nextEligibleAt
                        ? formatPostCountdown(
                            account.nextEligibleAt,
                            false,
                            nowMs,
                          )
                        : null);

                  return (
                  <li
                    key={account.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm"
                  >
                    <span className="font-medium">@{account.username}</span>
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        data.autoPost?.enabled &&
                          account.canPostNow
                          ? "font-semibold text-accent"
                          : "text-muted",
                      )}
                    >
                      {!data.autoPost?.enabled
                        ? "Auto-post off"
                        : account.canPostNow
                          ? accountCountdown
                            ? `Ready · check in ${accountCountdown.value}`
                            : "Ready to auto-post"
                          : account.nextEligibleAt && accountCountdown
                            ? `Posts ${accountCountdown.value}`
                            : account.lastPublishedAt
                              ? `Last posted ${formatWhen(account.lastPublishedAt)}`
                              : "Waiting for first video"}
                    </span>
                  </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-border bg-surface/70 p-5">
              <div className="mb-4 flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-accent" />
                <h3 className="font-display text-lg font-semibold">
                  Schedule a Reel
                </h3>
              </div>

              {!data.accounts.length || !data.exports.length ? (
                <p className="text-sm text-muted">
                  {!data.accounts.length
                    ? "Connect an Instagram account first."
                    : "No unpublished finished videos left. Create new ones in Produce or browse Library → Exports."}
                </p>
              ) : (
                <div className="space-y-4">
                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-muted">
                      Account
                    </span>
                    <select
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                      className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm outline-none focus:border-accent/50"
                    >
                      {data.accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          @{account.username}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-muted">
                      Finished video
                    </span>
                    <select
                      value={exportId}
                      onChange={(e) => {
                        setExportId(e.target.value);
                        setCaption("");
                      }}
                      className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm outline-none focus:border-accent/50"
                    >
                      {data.exports.map((exp) => (
                        <option key={exp.id} value={exp.id}>
                          {exp.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-muted">
                      Caption
                    </span>
                    <textarea
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      rows={4}
                      className="w-full resize-y rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm outline-none focus:border-accent/50"
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-muted">
                      Post at
                    </span>
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm outline-none focus:border-accent/50"
                    />
                  </label>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void schedule(false)}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-fg disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CalendarClock className="h-4 w-4" />
                      )}
                      Schedule
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void schedule(true)}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm font-semibold disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" />
                      Publish now
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-surface/70">
              {selectedExport ? (
                <ReelPlayer
                  key={selectedExport.id}
                  size="xl"
                  src={selectedExport.url}
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : (
                <div
                  className={cn(
                    reelFrameClass("xl"),
                    "flex items-center justify-center text-sm text-muted",
                  )}
                >
                  Select a finished video
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-surface/70 p-5">
            <h3 className="mb-4 font-display text-lg font-semibold">
              Scheduled & published
            </h3>
            {!data.scheduledPosts.length ? (
              <p className="text-sm text-muted">No scheduled posts yet.</p>
            ) : (
              <ul className="space-y-3">
                {data.scheduledPosts.map((post) => {
                  const account = data.accounts.find(
                    (a) => a.id === post.accountId,
                  );
                  const exp = data.exports.find((e) => e.id === post.exportId);
                  return (
                    <li
                      key={post.id}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-surface-raised p-3"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-sm font-medium">
                          {post.exportName || exp?.name || post.exportId}
                          {post.id.startsWith("auto-") && (
                            <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                              Auto
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted">
                          @{account?.username || "account"} ·{" "}
                          {formatWhen(post.scheduledAt)}
                        </p>
                        {post.caption && (
                          <p className="line-clamp-2 text-xs text-muted">
                            {post.caption}
                          </p>
                        )}
                        {post.error && (
                          <p className="text-xs text-danger">{post.error}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill status={post.status} />
                        {post.status === "scheduled" &&
                          !post.id.startsWith("auto-") && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void cancelPost(post.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-muted hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Cancel
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: ScheduledPost["status"] }) {
  const map = {
    scheduled: {
      label: "Scheduled",
      className: "bg-accent/15 text-accent",
      icon: CalendarClock,
    },
    publishing: {
      label: "Publishing",
      className: "bg-warning/15 text-warning",
      icon: Loader2,
    },
    published: {
      label: "Published",
      className: "bg-emerald-500/15 text-emerald-400",
      icon: CheckCircle2,
    },
    failed: {
      label: "Failed",
      className: "bg-danger/15 text-danger",
      icon: XCircle,
    },
    cancelled: {
      label: "Cancelled",
      className: "bg-surface-hover text-muted",
      icon: XCircle,
    },
  } as const;

  const item = map[status];
  const Icon = item.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold",
        item.className,
      )}
    >
      <Icon
        className={cn("h-3 w-3", status === "publishing" && "animate-spin")}
      />
      {item.label}
    </span>
  );
}
