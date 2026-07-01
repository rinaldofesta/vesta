// Memory Manager — extracts and manages personal facts from conversations.
// Uses the LLM to understand natural language mentions of preferences, facts, routines, etc.
// Runs asynchronously after each assistant response (fire-and-forget).

import { v4 as uuid } from "uuid";
import {
  generate,
  isLoaded,
  stopGeneration,
  getContextSize,
} from "../llm/llm-engine";
import type { CompletionMessage } from "../llm/llm-engine";
import {
  saveMemory,
  getAllMemories,
  getTopMemories,
  findMemoryByContent,
  bumpMemoryAccess,
  decayMemories as dbDecayMemories,
} from "../storage/database";
import type { Memory } from "../storage/database";
import { stripThinkTags } from "./response-parser";
import type { Language } from "./types";

type MemoryCategory = Memory["category"];

// Re-export the pure extraction gate (defined in a dependency-free module so it
// can be unit-tested without the LLM engine).
export { shouldExtractMemory } from "./memory-gate";

interface ExtractedMemory {
  category: MemoryCategory;
  content: string;
}

const VALID_CATEGORIES = new Set<string>([
  "preference",
  "fact",
  "routine",
  "contact_note",
  "topic_interest",
]);

// Prevent concurrent extraction runs.
let extractionRunning = false;
// Abort flag: set when a user turn needs the engine, or on timeout. The
// extraction's token callback checks this and stops the native completion so
// the engine lock is released promptly instead of blocking the user's message.
let extractionAbort = false;
const EXTRACTION_TIMEOUT_MS = 30_000;
const EXTRACTION_MAX_TOKENS = 256;
// Rough token estimate (~3 chars/token is conservative for Italian/English
// BPE) plus per-message chat-template overhead. Only used to decide whether
// the extraction turn fits the context window — precision doesn't matter.
const TEMPLATE_TOKENS_PER_MESSAGE = 8;
const CONTEXT_SAFETY_MARGIN = 128;

function estimatePromptTokens(messages: CompletionMessage[]): number {
  return messages.reduce(
    (n, m) => n + Math.ceil(m.content.length / 3) + TEMPLATE_TOKENS_PER_MESSAGE,
    0,
  );
}

/**
 * Cancel an in-flight extraction so the user's next message isn't queued
 * behind a background LLM pass. Safe to call when nothing is running.
 */
export function cancelExtraction(): void {
  if (!extractionRunning) return;
  extractionAbort = true;
  stopGeneration().catch(() => {});
}

/**
 * Extract personal facts from a conversation exchange using the LLM.
 * Runs asynchronously — fire and forget. Skips if model is busy or unloaded.
 * Cancellable: processMessage calls cancelExtraction() so a user turn never
 * waits for a background extraction to finish. Includes a timeout that stops
 * the generation (not just the guard) if the LLM hangs.
 *
 * Takes the chat turn's own message list and appends the extraction request as
 * one more turn instead of using a standalone extraction prompt. This is a
 * KV-cache requirement, not a convenience: the engine has a single context,
 * and a completion only reuses the cache for its common token prefix with the
 * previous one. A standalone prompt shares no prefix with the chat, so it
 * evicted the cached system-prompt/tool-schema block and the NEXT user turn
 * re-prefilled it cold (~17s measured on device). Sharing the chat prefix
 * makes extraction itself a cheap append AND leaves the chat prefix cached.
 */
export async function extractMemories(
  chatMessages: CompletionMessage[],
  assistantText: string,
  messageId: string,
  lang: Language,
): Promise<void> {
  if (!isLoaded() || extractionRunning) return;
  extractionRunning = true;
  extractionAbort = false;

  // Guards ONLY the LLM call and is disarmed the moment it returns: firing
  // later would stopGeneration() an unrelated completion — after the engine
  // lock releases, the "current generation" may be the user's next message.
  let generationDone = false;
  const timeoutId = setTimeout(() => {
    if (generationDone) return;
    console.warn("[MemoryManager] Extraction timed out, stopping generation");
    extractionAbort = true;
    stopGeneration().catch(() => {});
  }, EXTRACTION_TIMEOUT_MS);

  try {
    const instruction =
      lang === "it"
        ? `Estrai i fatti personali NUOVI che l'utente ha dichiarato nel suo ULTIMO messaggio qui sopra.
Rispondi con SOLO un array JSON valido di oggetti {"category": "...", "content": "..."} — niente testo, niente spiegazioni.
Categorie valide: preference, fact, routine, contact_note, topic_interest
Ignora le sezioni "Cosa sai dell'utente" e "Contesto personale dell'utente": sono informazioni già note, non estrarle di nuovo.
Se non ci sono fatti nuovi, rispondi []
Non inventare nulla. Estrai SOLO informazioni esplicitamente dette dall'utente nel suo ultimo messaggio.`
        : `Extract the NEW personal facts the user stated in their LAST message above.
Reply with ONLY a valid JSON array of {"category": "...", "content": "..."} objects — no prose, no explanation.
Valid categories: preference, fact, routine, contact_note, topic_interest
Ignore the "What you know about the user" and "User's personal context" sections — they are already known, do not extract them again.
If there are no new facts, reply []
Do not invent anything. Extract ONLY information the user explicitly stated in their last message.`;

    const messages: CompletionMessage[] = [
      ...chatMessages,
      { role: "assistant", content: assistantText },
      { role: "user", content: instruction },
    ];

    // Skip when the extraction turn wouldn't fit the context window: pushing
    // past n_ctx triggers ctx_shift, which rolls the oldest tokens — the very
    // system-prompt/tool-schema prefix this prefix-sharing design keeps cached
    // — out of the KV cache. Skipping a best-effort background pass is cheaper
    // than evicting the prefix (and a shifted cache would also degrade the
    // extraction itself).
    const budget =
      getContextSize() - EXTRACTION_MAX_TOKENS - CONTEXT_SAFETY_MARGIN;
    if (estimatePromptTokens(messages) > budget) {
      console.log(
        "[MemoryManager] Skipping extraction: conversation too close to the context limit",
      );
      return;
    }

    // Extraction emits a tiny JSON array — thinking is pure waste here, and a
    // small token cap keeps this background pass short on a phone (LLM-4).
    const result = await generate(
      messages,
      {
        maxTokens: EXTRACTION_MAX_TOKENS,
        temperature: 0.1,
        enableThinking: false,
      },
      // Check the abort flag on each token so cancellation lands within a
      // token or two instead of running to completion.
      () => {
        if (extractionAbort) stopGeneration().catch(() => {});
      },
    );
    // Disarm the timeout immediately: from here on there is nothing left to
    // stop, and the next completion the engine runs may be the user's.
    generationDone = true;
    clearTimeout(timeoutId);

    const raw = stripThinkTags(result.text);
    const extracted = parseExtractionResult(raw);

    if (extracted.length > 0) {
      await saveExtractedMemories(extracted, messageId);
    }
  } catch (err) {
    if (!extractionAbort) {
      console.warn("[MemoryManager] Extraction failed:", err);
    }
  } finally {
    clearTimeout(timeoutId);
    extractionRunning = false;
    extractionAbort = false;
  }
}

/**
 * Parse the LLM extraction output into structured memories.
 */
function parseExtractionResult(raw: string): ExtractedMemory[] {
  // Try direct JSON parse
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return validateExtracted(parsed);
  } catch {}

  // Try extracting JSON array from response
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return validateExtracted(parsed);
    } catch {}
  }

  return [];
}

function validateExtracted(arr: unknown[]): ExtractedMemory[] {
  return arr
    .filter(
      (item): item is { category: string; content: string } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).category === "string" &&
        typeof (item as Record<string, unknown>).content === "string" &&
        VALID_CATEGORIES.has((item as Record<string, unknown>).category as string),
    )
    .map((item) => ({
      category: item.category as MemoryCategory,
      content: item.content.trim(),
    }))
    .filter((m) => m.content.length > 0 && m.content.length < 500);
}

/**
 * Save extracted memories with deduplication.
 * If a similar memory already exists, bump its access count instead.
 */
async function saveExtractedMemories(
  extracted: ExtractedMemory[],
  messageId: string,
): Promise<void> {
  const existing = await getAllMemories();

  for (const mem of extracted) {
    // Check for duplicates using word overlap
    const duplicate = findDuplicate(mem.content, existing);

    if (duplicate) {
      // Bump existing memory instead of creating duplicate
      await bumpMemoryAccess([duplicate.id]);
    } else {
      await saveMemory({
        id: uuid(),
        category: mem.category,
        content: mem.content,
        sourceMessageId: messageId,
        confidence: 1.0,
      });
    }
  }
}

/**
 * Find a duplicate memory using Jaccard word similarity.
 */
function findDuplicate(
  newContent: string,
  existing: Memory[],
): Memory | null {
  const newWords = new Set(
    newContent
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

  for (const mem of existing) {
    const existingWords = new Set(
      mem.content
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );

    const intersection = [...newWords].filter((w) => existingWords.has(w));
    const unionSize = new Set([...newWords, ...existingWords]).size;

    if (unionSize > 0 && intersection.length / unionSize > 0.6) {
      return mem;
    }
  }

  return null;
}

/**
 * Get formatted memories for injection into the system prompt.
 */
export async function getMemoriesForPrompt(
  limit = 15,
): Promise<string | null> {
  const memories = await getTopMemories(limit);
  if (memories.length === 0) return null;

  // NOTE: do NOT bump access_count/last_accessed here. Bumping on every prompt
  // injection pinned the same top-N memories forever: their last_accessed was
  // always "now", so the time-decay factor in getTopMemories stayed at ~1.0 and
  // decayMemories() could never fire. That made the ranking self-reinforcing
  // (memories that fell out of the top-N could never climb back) and froze out
  // newly extracted facts. Leave access metrics untouched at injection time.
  const lines = memories.map(
    (m) => `- (${m.category}) ${m.content}`,
  );
  return lines.join("\n");
}

/**
 * Run periodic decay on old unused memories.
 * Call this on app startup or periodically.
 */
export async function runMemoryDecay(): Promise<void> {
  try {
    await dbDecayMemories();
  } catch (err) {
    console.warn("[MemoryManager] Decay failed:", err);
  }
}
