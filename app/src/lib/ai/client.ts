import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic();

// Vision-based extraction over scanned brokerage forms; Opus-tier accuracy
// matters here (handwriting, dense OREA forms). Override via env if needed.
export const AI_MODEL = process.env.AI_MODEL ?? "claude-opus-4-8";
