import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic();

// Vision-based extraction over scanned brokerage forms; Opus-tier accuracy
// matters here (handwriting, dense OREA forms). Override via env if needed.
export const AI_MODEL = process.env.AI_MODEL ?? "claude-opus-4-8";
export const CLASSIFICATION_AI_MODEL = process.env.CLASSIFICATION_AI_MODEL ?? AI_MODEL;
export const EXTRACTION_AI_MODEL = process.env.EXTRACTION_AI_MODEL ?? AI_MODEL;
export const LIGHT_AI_MODEL = process.env.LIGHT_AI_MODEL ?? CLASSIFICATION_AI_MODEL;
