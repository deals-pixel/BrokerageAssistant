import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PageClassification } from "./schemas";

const CACHE_VERSION = "page-classification-2026-06-25-v1";

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

export async function writeCachedClassification({
  cacheKey,
  model,
  pageHashes,
  classification,
}: {
  cacheKey: string;
  model: string;
  pageHashes: string[];
  classification: PageClassification;
}) {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("ai_classification_cache").upsert({
      cache_key: cacheKey,
      model,
      page_hashes: pageHashes,
      classification_json: classification,
    });
    if (error) console.error("AI classification cache write failed", error.message);
  } catch (err) {
    console.error("AI classification cache write failed", err);
  }
}
