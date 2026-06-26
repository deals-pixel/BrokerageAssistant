import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PageClassification } from "./schemas";

const CACHE_VERSION = "page-classification-2026-06-26-v2";

type CachePage = {
  pageNumber: number;
  pageHash?: string | null;
};

type CacheIdentity = {
  model: string;
  pages: CachePage[];
  promptSignature: string;
};

export function classificationCacheKey(identity: CacheIdentity) {
  const pageParts = identity.pages.map((page) => {
    if (!page.pageHash) return null;
    return `${page.pageNumber}:${page.pageHash}`;
  });
  if (pageParts.some((part) => part == null)) return null;

  return createHash("sha256")
    .update(
      JSON.stringify({
        version: CACHE_VERSION,
        model: identity.model,
        pages: pageParts,
        promptSignature: identity.promptSignature,
      }),
    )
    .digest("hex");
}

export function pageClassificationCacheKey({
  model,
  pageHash,
  promptSignature,
}: {
  model: string;
  pageHash?: string | null;
  promptSignature: string;
}) {
  if (!pageHash) return null;
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: CACHE_VERSION,
        scope: "page",
        model,
        pageHash,
        promptSignature,
      }),
    )
    .digest("hex");
}

export async function readCachedClassification(cacheKey: string): Promise<PageClassification | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("ai_classification_cache")
      .select("classification_json")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error) {
      console.error("AI classification cache read failed", error.message);
      return null;
    }
    return (data?.classification_json as PageClassification | null) ?? null;
  } catch (err) {
    console.error("AI classification cache read failed", err);
    return null;
  }
}

export async function readCachedPageClassifications(
  pages: Array<{ pageNumber: number; pageHash?: string | null }>,
  {
    model,
    promptSignature,
  }: {
    model: string;
    promptSignature: string;
  },
) {
  const keyedPages = pages
    .map((page) => ({
      ...page,
      cacheKey: pageClassificationCacheKey({ model, pageHash: page.pageHash, promptSignature }),
    }))
    .filter((page): page is { pageNumber: number; pageHash: string; cacheKey: string } => Boolean(page.cacheKey));
  if (keyedPages.length === 0) return new Map<number, PageClassification["pages"][number]>();

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("ai_classification_cache")
      .select("cache_key, classification_json")
      .in("cache_key", keyedPages.map((page) => page.cacheKey));
    if (error) {
      console.error("AI page classification cache read failed", error.message);
      return new Map<number, PageClassification["pages"][number]>();
    }

    const rowsByKey = new Map(
      (data ?? []).map((row) => [row.cache_key as string, row.classification_json as PageClassification]),
    );
    const result = new Map<number, PageClassification["pages"][number]>();
    for (const page of keyedPages) {
      const cachedPage = rowsByKey.get(page.cacheKey)?.pages?.[0];
      if (!cachedPage) continue;
      result.set(page.pageNumber, { ...cachedPage, page_number: page.pageNumber });
    }
    return result;
  } catch (err) {
    console.error("AI page classification cache read failed", err);
    return new Map<number, PageClassification["pages"][number]>();
  }
}

export async function writeCachedClassification({
  cacheKey,
  model,
  pageHashes,
  classification,
  promptSignature,
  cacheScope = "batch",
  pageHash = null,
}: {
  cacheKey: string;
  model: string;
  pageHashes: string[];
  classification: PageClassification;
  promptSignature?: string | null;
  cacheScope?: "batch" | "page";
  pageHash?: string | null;
}) {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("ai_classification_cache").upsert({
      cache_key: cacheKey,
      model,
      page_hashes: pageHashes,
      classification_json: classification,
      prompt_signature: promptSignature ?? null,
      cache_scope: cacheScope,
      page_hash: pageHash,
    });
    if (error) console.error("AI classification cache write failed", error.message);
  } catch (err) {
    console.error("AI classification cache write failed", err);
  }
}

export async function writeCachedPageClassifications({
  model,
  promptSignature,
  transactionType,
  pages,
}: {
  model: string;
  promptSignature: string;
  transactionType: PageClassification["transaction_type"];
  pages: Array<PageClassification["pages"][number] & { pageHash?: string | null }>;
}) {
  await Promise.all(
    pages.map(async (page) => {
      const cacheKey = pageClassificationCacheKey({ model, pageHash: page.pageHash, promptSignature });
      if (!cacheKey || !page.pageHash) return;
      const { pageHash: _pageHash, ...classificationPage } = page;
      await writeCachedClassification({
        cacheKey,
        model,
        pageHashes: [page.pageHash],
        classification: {
          transaction_type: transactionType,
          pages: [classificationPage],
        },
        promptSignature,
        cacheScope: "page",
        pageHash: page.pageHash,
      });
    }),
  );
}
