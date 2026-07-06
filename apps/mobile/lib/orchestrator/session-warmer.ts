// Session warmer — orchestrator-side glue for the cold-start prefix cache.
//
// The cache itself (lib/llm/session-cache.ts) knows nothing about how Vesta's
// prompt is assembled. This module owns that: it builds the same stable prefix
// the orchestrator sends (language + memories + knowledge) and hands it to the
// cache for restore (at app start) and persist (after a clean turn).

import { estimatePromptTokens, getContextSize } from "../llm/llm-engine";
import type { CompletionMessage } from "../llm/llm-engine";
import {
  persistPrefixSession,
  restorePrefixSession,
} from "../llm/session-cache";
import { buildStablePrefix, annotateUserMessage } from "./prompt-builder";
import { getMemoriesForPrompt } from "./memory-manager";
import { getKnowledgeForPrompt } from "./knowledge-manager";
import { getConfig } from "../storage/database";
import type { Language } from "./types";

// Probe instants for locating the stable/volatile token boundary: two probe
// first-user-messages rendered at different dates diverge at the first
// time-derived token of their [Contesto temporale: ...] line (the V4 system
// prompt itself is fully static). The exact values never reach the model —
// only their tokenizations are compared. Different weekdays on purpose, so
// the divergence lands at the very first field of the annotation.
const PROBE_DATE_A = new Date(2020, 0, 2, 3, 4);
const PROBE_DATE_B = new Date(2031, 10, 25, 23, 58);

// If the whole turn (prompt + generated tokens) came near n_ctx, ctx_shift may
// have rolled the prefix out of the KV cache — persisting then would snapshot
// garbage. Same margin philosophy as memory extraction's budget guard.
const PERSIST_SAFETY_MARGIN = 256;

/**
 * Restore the persisted prefix KV state, if any. Call once at app start,
 * after the model loads and BEFORE the first completion. Failures are
 * non-fatal: the first turn just prefills cold, as it does today.
 */
export async function warmSessionCache(): Promise<void> {
  try {
    const [lang, memoriesBlock, knowledgeBlock] = await Promise.all([
      getConfig("language"),
      getMemoriesForPrompt(),
      getKnowledgeForPrompt(),
    ]);
    const language: Language = lang === "en" ? "en" : "it";
    const stablePrefix = buildStablePrefix(language, memoriesBlock, knowledgeBlock);
    await restorePrefixSession(stablePrefix);
  } catch (err) {
    console.warn("[SessionWarmer] warm failed (starting cold):", err);
  }
}

/**
 * Fire-and-forget after a clean user turn: persist the prefix KV state if the
 * on-disk cache is missing or stale. `turnMessages` is the message list the
 * turn was generated from; `tokensPredicted` its generated-token count — both
 * feed the ctx_shift guard.
 */
export function schedulePrefixPersist(
  stablePrefix: string,
  lang: Language,
  turnMessages: CompletionMessage[],
  tokensPredicted: number,
): void {
  const estimatedState = estimatePromptTokens(turnMessages) + tokensPredicted;
  if (estimatedState > getContextSize() - PERSIST_SAFETY_MARGIN) {
    return; // ctx_shift may have evicted the prefix — skip, retry next turn
  }
  persistPrefixSession(
    stablePrefix,
    annotateUserMessage(lang, PROBE_DATE_A, "."),
    annotateUserMessage(lang, PROBE_DATE_B, "."),
  ).catch((err) => {
    console.warn("[SessionWarmer] persist failed:", err);
  });
}
