import { z } from "zod";
import { DOCUMENT_TYPES } from "@/lib/types";

const docTypeKeys = Object.keys(DOCUMENT_TYPES) as [string, ...string[]];

export const PageClassificationSchema = z.object({
  pages: z.array(
    z.object({
      page_number: z.number().int(),
      doc_type: z.enum(docTypeKeys),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  transaction_type: z.enum(["purchase", "lease", "unknown"]),
});
export type PageClassification = z.infer<typeof PageClassificationSchema>;

const extractedField = z.object({
  value: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  source_page: z.number().int().nullable(),
  source_box: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1),
      height: z.number().min(0).max(1),
    })
    .nullable(),
});

// One flat object per document group; keys match ALL_FIELD_KEYS.
// All fields nullable — the model only fills what the document shows.
export const FieldExtractionSchema = z.object({
  fields: z.array(
    z.object({
      field_key: z.string(),
      value: z.string().nullable(),
      confidence: z.enum(["high", "medium", "low"]),
      source_page: z.number().int().nullable(),
      source_box: z
        .object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          width: z.number().min(0).max(1),
          height: z.number().min(0).max(1),
        })
        .nullable(),
    }),
  ),
});
export type FieldExtraction = z.infer<typeof FieldExtractionSchema>;

export const _internal = { extractedField };
