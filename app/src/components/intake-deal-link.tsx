"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { acknowledgeDealAttention } from "@/components/intake-new-badge";

type IntakeDealLinkProps = ComponentProps<typeof Link> & {
  dealId: string;
};

export function IntakeDealLink({ dealId, onClick, ...props }: IntakeDealLinkProps) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        acknowledgeDealAttention(dealId);
        onClick?.(event);
      }}
    />
  );
}
