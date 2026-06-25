"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

const STORAGE_KEY = "brokerage-assistant-opened-intake-deals";

export function IntakeNewBadge({ dealId }: { dealId: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const opened = readOpenedDeals();
    setVisible(!opened.has(dealId));
  }, [dealId]);

  if (!visible) return null;
  return (
    <Badge variant="secondary" className="h-4 border border-blue-200 bg-blue-50 px-1.5 text-[11px] leading-4 text-blue-800">
      New
    </Badge>
  );
}

export function rememberOpenedIntakeDeal(dealId: string) {
  const opened = readOpenedDeals();
  opened.add(dealId);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...opened]));
}

function readOpenedDeals() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}
