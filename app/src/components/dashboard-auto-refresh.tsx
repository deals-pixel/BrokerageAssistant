"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

export function DashboardAutoRefresh({ intervalMs = 8000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    function scrollToProcessedDeal() {
      const dealId = window.sessionStorage.getItem("dashboard-scroll-deal-id");
      if (!dealId) return;

      const selector = `[data-deal-id="${CSS.escape(dealId)}"]`;
      const target = document.querySelector<HTMLElement>(selector);
      if (!target) return;

      window.sessionStorage.removeItem("dashboard-scroll-deal-id");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.animate(
        [
          { boxShadow: "0 0 0 0 rgba(55, 138, 221, 0)" },
          { boxShadow: "0 0 0 4px rgba(55, 138, 221, 0.35)" },
          { boxShadow: "0 0 0 0 rgba(55, 138, 221, 0)" },
        ],
        { duration: 1400, easing: "ease-out" },
      );
    }

    window.setTimeout(scrollToProcessedDeal, 120);

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
