"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type FilterKey = "all" | "intake" | "incomplete" | "ready" | "closing_week";
type ViewKey = "status" | "time" | "table" | "archive";

export type DashboardSearchOption = {
  id: string;
  label: string;
  meta: string;
  status: string;
  createdAt: string;
  searchText: string;
};

export function DashboardSearchAutocomplete({
  view,
  filter,
  initialQuery,
  options,
}: {
  view: ViewKey;
  filter: FilterKey;
  initialQuery: string;
  options: DashboardSearchOption[];
}) {
  const router = useRouter();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rankedOptions = useMemo(() => rankSearchOptions(options, query), [options, query]);
  const visibleOptions = rankedOptions.slice(0, 8);
  const trimmedQuery = normalizeQuery(query);
  const showDropdown = open && (visibleOptions.length > 0 || trimmedQuery.length > 0);
  const activeOption = activeIndex >= 0 ? visibleOptions[activeIndex] : undefined;

  useEffect(() => {
    setQuery(initialQuery);
    setActiveIndex(-1);
  }, [initialQuery]);

  function navigateToSearch(value: string) {
    const nextQuery = normalizeQuery(value);
    setQuery(nextQuery);
    setOpen(false);
    setActiveIndex(-1);
    router.push(dashboardHref({ view, filter, q: nextQuery }));
  }

  function clearSearch() {
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
    if (initialQuery) router.push(dashboardHref({ view, filter }));
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigateToSearch(query);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (visibleOptions.length === 0 ? -1 : Math.min(index + 1, visibleOptions.length - 1)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (visibleOptions.length === 0 ? -1 : Math.max(index - 1, 0)));
      return;
    }

    if (event.key === "Enter" && open && activeIndex >= 0 && visibleOptions[activeIndex]) {
      event.preventDefault();
      navigateToSearch(visibleOptions[activeIndex].label);
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative z-20 ml-auto flex min-w-[240px] max-w-sm flex-1 items-center gap-2 sm:flex-none">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={handleInputKeyDown}
          placeholder="Search address"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-activedescendant={activeOption ? `${listboxId}-${activeOption.id}` : undefined}
          autoComplete="off"
          className="h-8 rounded-md pl-8 pr-8 text-sm"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onMouseDown={(event) => event.preventDefault()}
            onClick={clearSearch}
            className="absolute right-2 top-1/2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}

        {showDropdown && (
          <div
            id={listboxId}
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-50 max-h-72 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg"
          >
            <div className="px-2 py-1.5 text-[11px] font-medium uppercase text-muted-foreground">
              {trimmedQuery ? "Matching transactions" : "Recent transactions"}
            </div>
            {visibleOptions.length === 0 ? (
              <div className="px-2 py-2 text-sm text-muted-foreground">No matching transactions</div>
            ) : (
              visibleOptions.map((option, index) => (
                <button
                  key={option.id}
                  id={`${listboxId}-${option.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => navigateToSearch(option.label)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-2 text-left text-sm transition",
                    index === activeIndex ? "bg-muted text-foreground" : "hover:bg-muted/60",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{option.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{option.meta || "No transaction metadata"}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                    <span className={cn("size-1.5 rounded-full", statusDotClassName(option.status))} />
                    {option.status}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <Button type="submit" size="sm" variant="outline" className="h-8">
        <Search className="size-3.5" />
        Search
      </Button>
    </form>
  );
}

function dashboardHref({ view, filter, q }: { view: ViewKey; filter: FilterKey; q?: string }) {
  const params = new URLSearchParams();
  if (view !== "status") params.set("view", view);
  if (filter !== "all") params.set("filter", filter);
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function rankSearchOptions(options: DashboardSearchOption[], query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const compactQuery = normalizedQuery.replace(/\s/g, "");
  const matches = normalizedQuery
    ? options
        .map((option) => ({ option, score: searchOptionScore(option, normalizedQuery, compactQuery) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || b.option.createdAt.localeCompare(a.option.createdAt))
        .map((item) => item.option)
    : [...options].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return matches;
}

function searchOptionScore(option: DashboardSearchOption, normalizedQuery: string, compactQuery: string) {
  const haystack = normalizeSearchText(option.searchText);
  const compactHaystack = haystack.replace(/\s/g, "");
  if (!normalizedQuery) return 1;
  if (haystack === normalizedQuery || compactHaystack === compactQuery) return 100;
  if (haystack.includes(normalizedQuery) || compactHaystack.includes(compactQuery)) return 80;

  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  if (queryTokens.length === 0) return 0;
  const haystackTokens = haystack.split(" ").filter(Boolean);
  const tokenMatches = queryTokens.filter((queryToken) =>
    haystackTokens.some((token) => searchTokenMatches(token, queryToken)),
  ).length;
  if (tokenMatches === queryTokens.length) return 60 + tokenMatches;

  if (compactQuery.length >= 3 && isSubsequence(compactQuery, compactHaystack)) return 30;
  return 0;
}

function searchTokenMatches(token: string, queryToken: string) {
  if (token === queryToken || token.includes(queryToken) || queryToken.includes(token)) return true;
  const minLength = Math.min(token.length, queryToken.length);
  if (minLength < 5) return false;
  const distance = searchEditDistance(token, queryToken);
  if (distance <= 1) return true;
  return minLength >= 8 && distance <= 2;
}

function normalizeQuery(value: string) {
  return value.trim().slice(0, 80);
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(circle|cir)\b/g, "cir")
    .replace(/\b(court|ct)\b/g, "ct")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    .replace(/\b(unit|suite|apt|apartment)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isSubsequence(query: string, value: string) {
  let queryIndex = 0;
  for (let valueIndex = 0; valueIndex < value.length && queryIndex < query.length; valueIndex += 1) {
    if (query[queryIndex] === value[valueIndex]) queryIndex += 1;
  }
  return queryIndex === query.length;
}

function searchEditDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function statusDotClassName(status: string) {
  if (status === "Ready") return "bg-emerald-500";
  if (status === "Incomplete") return "bg-amber-500";
  if (status === "Intake Review") return "bg-gray-500";
  if (status === "Submitted") return "bg-slate-500";
  return "bg-blue-500";
}
