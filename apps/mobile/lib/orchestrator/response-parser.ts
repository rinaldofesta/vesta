// Parses LLM responses into structured tool calls or plain text.
// Ported from scripts/benchmark/run.ts — the same logic that was validated
// against real model outputs in Fase 0.

import type { ParsedToolCall } from "./types";

/** Strip <think>...</think> blocks and orphan tags from LLM output. */
export function stripThinkTags(text: string): string {
  // Remove paired <think>...</think> blocks
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Handle orphan </think> (model started thinking before output capture)
  const thinkEnd = cleaned.lastIndexOf("</think>");
  if (thinkEnd !== -1) {
    cleaned = cleaned.substring(thinkEnd + "</think>".length).trim();
  }
  return cleaned;
}

export function parseResponse(raw: string): ParsedToolCall | null {
  const cleaned = stripThinkTags(raw);

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.tool === "string") {
      return parsed as ParsedToolCall;
    }
  } catch {
    // not pure JSON
  }

  // Try to extract JSON from markdown code blocks
  const jsonMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed && typeof parsed.tool === "string") {
        return parsed as ParsedToolCall;
      }
    } catch {
      // failed
    }
  }

  // Try to find JSON object containing "tool" key in the response
  const braceMatch = cleaned.match(/\{[\s\S]*"tool"\s*:[\s\S]*\}/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      if (parsed && typeof parsed.tool === "string") {
        return parsed as ParsedToolCall;
      }
    } catch {
      // failed
    }
  }

  return null;
}
