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

/**
 * Extract the first balanced JSON object containing a "tool" key.
 * Tracks brace depth so nested objects are handled correctly.
 */
function extractBalancedJson(text: string): string | null {
  let start = -1;
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        const candidate = text.substring(start, i + 1);
        if (/"tool"\s*:/.test(candidate)) {
          return candidate;
        }
        // Reset — this object didn't contain "tool", keep scanning
        start = -1;
      }
    } else if (ch === '"') {
      // Skip string contents to avoid counting braces inside strings
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") i++; // skip escaped char
        i++;
      }
    }
  }
  return null;
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

  // Try to find a balanced JSON object containing "tool" key in the response.
  // Uses depth-tracking instead of greedy regex to avoid matching from the
  // first '{' to the last '}' when multiple JSON objects are present.
  const toolObj = extractBalancedJson(cleaned);
  if (toolObj) {
    try {
      const parsed = JSON.parse(toolObj);
      if (parsed && typeof parsed.tool === "string") {
        return parsed as ParsedToolCall;
      }
    } catch {
      // failed
    }
  }

  return null;
}
