"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Link2,
  ListOrdered,
  Loader2,
  Plus,
  Send,
  Share2,
  Timer,
  Trash2,
  Unplug,
  Video,
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

type QueueItem = ScheduledPost & {
  exportUrl?: string | null;
};

type AccountQueue = {
  queue: QueueItem[];
  available: LibraryExport[];
  publishedCount: number;
};

type AutoPostAccountStatus = {
  id: string;
  username: string;
  lastPublishedAt: string | null;
  nextEligibleAt: string | null;
  canPostNow: boolean;
  queueLength?: number;
};

type InstagramPayload = {
  configured: boolean;
  redirectUri: string;
  canPublishMedia?: boolean;
  mediaBaseUrl?: string | null;
  accounts: PublicAccount[];
  scheduledPosts: ScheduledPost[];
  exports: LibraryExport[];
  queues: Record<string, AccountQueue>;
  autoPost?: {
    enabled: boolean;
    intervalHours?: 4 | 5 | 6;
    intervalOptions?: Array<4 | 5 | 6>;
    intervalMs?: number;
    intervalLabel?: string;
    next?: {
      exportId: string | null;
      exportName: string | null;
      accountId?: string | null;
      accountUsername?: string | null;
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
  const [activeAccountId, setActiveAccountId] = useState("");
  const [previewExportId, setPreviewExportId] = useState("");
  const [scheduleAccountId, setScheduleAccountId] = useState("");
  const [scheduleExportId, setScheduleExportId] = useState("");
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
      setActiveAccountId((current) => current || json.accounts[0]?.id || "");
      setScheduleAccountId((current) => current || json.accounts[0]?.id || "");
      setPreviewExportId((current) => {
        if (current && json.exports.some((exp) => exp.id === current)) {
          return current;
        }
        return json.exports[0]?.id || "";
      });
      setScheduleExportId((current) => {
        if (current && json.exports.some((exp) => exp.id === current)) {
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

  const activeAccount = useMemo(
    () => data?.accounts.find((account) => account.id === activeAccountId) ?? null,
    [data, activeAccountId],
  );

  const activeQueue = useMemo(
    () => (activeAccountId ? data?.queues?.[activeAccountId] : null) ?? null,
    [data, activeAccountId],
  );

  const previewExport = useMemo(
    () => data?.exports.find((exp) => exp.id === previewExportId) ?? null,
    [data, previewExportId],
  );

  const addToQueue = async (accountId: string, exportId: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/instagram/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, exportId }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not add to queue.");
      setActiveAccountId(accountId);
      setPreviewExportId(exportId);
      setNotice("Added to queue.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add to queue.");
    } finally {
      setBusy(false);
    }
  };

  const removeFromQueue = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/instagram/queue?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not remove from queue.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove from queue.");
    } finally {
      setBusy(false);
    }
  };

  const moveQueueItem = async (
    accountId: string,
    queue: QueueItem[],
    index: number,
    direction: -1 | 1,
  ) => {
    const target = index + direction;
    if (target < 0 || target >= queue.length) return;
    const orderedIds = queue.map((item) => item.id);
    [orderedIds[index], orderedIds[target]] = [
      orderedIds[target],
      orderedIds[index],
    ];
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/instagram/queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, orderedIds }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not reorder queue.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reorder queue.");
    } finally {
      setBusy(false);
    }
  };

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
    if (!scheduleAccountId || !scheduleExportId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/instagram/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: scheduleAccountId,
          exportId: scheduleExportId,
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
          Build a separate publishing queue for each Instagram account. Pick
          finished videos and add them to the channel you want, then auto-post
          drains each account&apos;s queue on its own schedule.
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-accent">
          {notice}
        </p>
      ) : null}

      {!data?.configured ? (
        <section className="rounded-2xl border border-border bg-surface/70 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Share2 className="h-4 w-4 text-accent" />
            <h3 className="font-display text-lg font-semibold">
              Connect Meta app
            </h3>
          </div>
          <p className="text-sm text-muted">
            Add Instagram app credentials to <code>.env.local</code>, then connect
            your accounts below.
          </p>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-border bg-surface/70 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold">Accounts</h3>
                <p className="mt-1 text-sm text-muted">
                  Each account gets its own queue and posting schedule.
                </p>
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
              <div className="flex flex-wrap gap-2">
                {data.accounts.map((account) => {
                  const queueLength = data.queues?.[account.id]?.queue.length ?? 0;
                  const selected = account.id === activeAccountId;
                  return (
                    <div
                      key={account.id}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-xl border px-2 py-1.5 text-sm transition-colors",
                        selected
                          ? "border-accent bg-accent/10 text-foreground"
                          : "border-border bg-surface-raised text-muted",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveAccountId(account.id)}
                        className="inline-flex items-center gap-2 px-1 py-0.5"
                      >
                        {account.profilePictureUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={account.profilePictureUrl}
                            alt=""
                            className="h-7 w-7 rounded-full object-cover"
                          />
                        ) : (
                          <Share2 className="h-4 w-4 text-accent" />
                        )}
                        <span className="font-medium">@{account.username}</span>
                        <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted">
                          {queueLength} queued
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void disconnect(account.id)}
                        className="rounded-md p-1 text-muted hover:text-danger"
                        aria-label={`Disconnect @${account.username}`}
                      >
                        <Unplug className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {data.accounts.length > 0 ? (
            <>
              <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border bg-surface/70 p-5">
                    <div className="mb-4 flex items-center gap-2">
                      <Video className="h-4 w-4 text-accent" />
                      <h3 className="font-display text-lg font-semibold">
                        Finished videos
                      </h3>
                    </div>
                    {!data.exports.length ? (
                      <p className="text-sm text-muted">
                        No finished videos yet. Create exports in Produce or
                        browse Library → Exports.
                      </p>
                    ) : (
                      <ul className="grid gap-3 sm:grid-cols-2">
                        {data.exports.map((exp) => (
                          <li
                            key={exp.id}
                            className={cn(
                              "overflow-hidden rounded-xl border bg-surface-raised",
                              previewExportId === exp.id
                                ? "border-accent/50"
                                : "border-border",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => setPreviewExportId(exp.id)}
                              className="block w-full text-left"
                            >
                              <ReelPlayer
                                size="sm"
                                src={exp.url}
                                controls={false}
                                playsInline
                                preload="metadata"
                              />
                              <div className="space-y-1 px-3 py-2">
                                <p className="truncate text-sm font-medium">
                                  {exp.name}
                                </p>
                                <p className="text-[11px] text-muted">
                                  {formatWhen(exp.createdAt)}
                                </p>
                              </div>
                            </button>
                            <div className="border-t border-border px-3 py-2">
                              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                                Add to queue
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {data.accounts.map((account) => {
                                  const available = data.queues?.[
                                    account.id
                                  ]?.available.some((item) => item.id === exp.id);
                                  const inQueue = data.queues?.[
                                    account.id
                                  ]?.queue.some((item) => item.exportId === exp.id);
                                  return (
                                    <button
                                      key={account.id}
                                      type="button"
                                      disabled={busy || !available || inQueue}
                                      onClick={() =>
                                        void addToQueue(account.id, exp.id)
                                      }
                                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium disabled:opacity-40"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                      @{account.username}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-2xl border border-border bg-surface/70 p-5">
                    <div className="mb-4 flex items-center gap-2">
                      <ListOrdered className="h-4 w-4 text-accent" />
                      <h3 className="font-display text-lg font-semibold">
                        {activeAccount
                          ? `@${activeAccount.username} queue`
                          : "Account queue"}
                      </h3>
                    </div>
                    {!activeQueue?.queue.length ? (
                      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
                        No videos queued for this account yet. Add finished
                        videos above.
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {activeQueue.queue.map((item, index) => (
                          <li
                            key={item.id}
                            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-raised p-3"
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
                              {index + 1}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {item.exportName || item.exportId}
                              </p>
                              <p className="text-xs text-muted">
                                Added {formatWhen(item.createdAt)}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={busy || index === 0}
                                onClick={() =>
                                  void moveQueueItem(
                                    activeAccountId,
                                    activeQueue.queue,
                                    index,
                                    -1,
                                  )
                                }
                                className="rounded-lg border border-border p-2 text-muted disabled:opacity-40"
                              >
                                <ArrowUp className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                disabled={
                                  busy || index === activeQueue.queue.length - 1
                                }
                                onClick={() =>
                                  void moveQueueItem(
                                    activeAccountId,
                                    activeQueue.queue,
                                    index,
                                    1,
                                  )
                                }
                                className="rounded-lg border border-border p-2 text-muted disabled:opacity-40"
                              >
                                <ArrowDown className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void removeFromQueue(item.id)}
                                className="rounded-lg border border-border p-2 text-muted hover:text-danger"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="overflow-hidden rounded-2xl border border-border bg-surface/70">
                    {previewExport ? (
                      <ReelPlayer
                        key={previewExport.id}
                        size="xl"
                        src={previewExport.url}
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

                  {data.autoPost ? (
                    <div className="rounded-2xl border border-border bg-surface/70 p-5">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Timer className="h-4 w-4 text-accent" />
                          <h3 className="font-display text-lg font-semibold">
                            Auto-post
                          </h3>
                        </div>
                        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={data.autoPost.enabled}
                            disabled={busy}
                            onChange={(event) =>
                              void updateAutoPost({ enabled: event.target.checked })
                            }
                            className="accent-accent"
                          />
                          Enabled
                        </label>
                      </div>
                      <p className="mb-3 text-sm text-muted">
                        Each account publishes the next video in its own queue
                        every{" "}
                        {data.autoPost.intervalLabel ??
                          `${data.autoPost.intervalHours ?? 5} hours`}.
                      </p>
                      <div className="mb-4 flex flex-wrap gap-2">
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
                                "rounded-xl px-3 py-2 text-sm font-semibold",
                                data.autoPost?.intervalHours === hours
                                  ? "bg-accent text-accent-fg"
                                  : "border border-border bg-surface-raised text-muted",
                              )}
                            >
                              {hours}h
                            </button>
                          ),
                        )}
                      </div>
                      {data.autoPost.next?.exportId ? (
                        <div className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
                          <p className="font-medium text-foreground">
                            Next up: {data.autoPost.next.exportName}
                          </p>
                          {data.autoPost.next.accountUsername ? (
                            <p className="mt-1 text-muted">
                              @{data.autoPost.next.accountUsername}
                              <ChevronRight className="mx-1 inline h-3.5 w-3.5" />
                              {formatPostCountdown(
                                data.autoPost.next.postsAt,
                                data.autoPost.next.eligibleNow,
                                nowMs,
                              ).value}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-surface/70 p-5">
                <div className="mb-4 flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-accent" />
                  <h3 className="font-display text-lg font-semibold">
                    Schedule a specific time
                  </h3>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-muted">Account</span>
                    <select
                      value={scheduleAccountId}
                      onChange={(event) =>
                        setScheduleAccountId(event.target.value)
                      }
                      className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm"
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
                      value={scheduleExportId}
                      onChange={(event) => {
                        setScheduleExportId(event.target.value);
                        setCaption("");
                      }}
                      className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm"
                    >
                      {(data.queues?.[scheduleAccountId]?.available ??
                        data.exports).map((exp) => (
                        <option key={exp.id} value={exp.id}>
                          {exp.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-2 lg:col-span-2">
                    <span className="text-xs font-medium text-muted">Caption</span>
                    <textarea
                      value={caption}
                      onChange={(event) => setCaption(event.target.value)}
                      rows={3}
                      className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm"
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-muted">Post at</span>
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(event) => setScheduledAt(event.target.value)}
                      className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm"
                    />
                  </label>
                  <div className="flex flex-wrap items-end gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void schedule(false)}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-fg disabled:opacity-50"
                    >
                      <CalendarClock className="h-4 w-4" />
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
              </section>

              <section className="rounded-2xl border border-border bg-surface/70 p-5">
                <h3 className="mb-4 font-display text-lg font-semibold">
                  History
                </h3>
                {!data.scheduledPosts.length ? (
                  <p className="text-sm text-muted">No posts yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {data.scheduledPosts.map((post) => {
                      const account = data.accounts.find(
                        (item) => item.id === post.accountId,
                      );
                      return (
                        <li
                          key={post.id}
                          className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-surface-raised p-3"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-sm font-medium">
                              {post.exportName || post.exportId}
                            </p>
                            <p className="text-xs text-muted">
                              @{account?.username || "account"} ·{" "}
                              {formatWhen(post.scheduledAt)}
                            </p>
                            {post.error ? (
                              <p className="text-xs text-danger">{post.error}</p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusPill status={post.status} />
                            {post.status === "scheduled" &&
                            post.source !== "auto" &&
                            !post.id.startsWith("auto-") ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void cancelPost(post.id)}
                                className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:text-danger"
                              >
                                Cancel
                              </button>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: ScheduledPost["status"] }) {
  const map = {
    queued: {
      label: "Queued",
      className: "bg-accent/15 text-accent",
      icon: ListOrdered,
    },
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
