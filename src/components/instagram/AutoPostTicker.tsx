"use client";

import { useEffect } from "react";

/** Keeps Instagram auto-post running while any Hookr page is open. */
export function AutoPostTicker() {
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        await fetch("/api/instagram/process-due", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      } catch {
        // background task — ignore transient network errors
      }
    };

    void tick();
    const id = window.setInterval(() => {
      if (!cancelled) void tick();
    }, 120_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
