"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

export function DashboardAutoRefresh({ intervalMs = 8000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    function refreshIfVisible(force = false) {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - lastRefreshAt.current < intervalMs) return;
      lastRefreshAt.current = now;
      startTransition(() => {
        router.refresh();
      });
    }

    const timer = window.setInterval(() => refreshIfVisible(), intervalMs);
    const handleVisibilityChange = () => refreshIfVisible(true);
    const handleFocus = () => refreshIfVisible(true);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [intervalMs, router]);

  return null;
}
