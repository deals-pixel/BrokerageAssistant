import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DocumentType } from "@/lib/types";
import type { FieldExtraction } from "./schemas";

const CACHE_VERSION = "field-extraction-2026-06-19-v1";

type CachePage = {
  pageNumber: number;
  pageHash?: string | null;
};

type CacheIdentity = {
  model: string;
  docType: DocumentType;
  pages: CachePage[];
  standardFormKeys?: string[];
};

export function extractionCacheKey(identity: CacheIdentity) {
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
        docType: identity.docType,
        pages: pageParts,
        standardFormKeys: identity.standardFormKeys ?? [],
      }),
    )
    .digest("hex");
}

export async function readCachedExtraction(cacheKey: string): Promise<FieldExtraction | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("ai_extraction_cache")
      .select("extraction_json")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error) {
      console.error("AI extraction cache read failed", error.message);
      return null;
    }
    return (data?.extraction_json as FieldExtraction | null) ?? null;
  } catch (err) {
    console.error("AI extraction cache read failed", err);
    return null;
  }
}

export async function writeCachedExtraction({
  cacheKey,
  model,
  docType,
  pageHashes,
  extraction,
}: {
  cacheKey: string;
  model: string;
  docType: DocumentType;
  pageHashes: string[];
  extraction: FieldExtraction;
}) {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("ai_extraction_cache").upsert({
      cache_key: cacheKey,
      model,
      document_type: docType,
      page_hashes: pageHashes,
      extraction_json: extraction,
    });
    if (error) console.error("AI extraction cache write failed", error.message);
  } catch (err) {
    console.error("AI extraction cache write failed", err);
  }
}
