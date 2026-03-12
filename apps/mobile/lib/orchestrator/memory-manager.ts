// Memory Manager — extracts and manages personal facts from conversations.
// Uses the LLM to understand natural language mentions of preferences, facts, routines, etc.
// Runs asynchronously after each assistant response (fire-and-forget).

import { v4 as uuid } from "uuid";
import { generate, isLoaded } from "../llm/llm-engine";
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

// Prevent concurrent extraction runs
let extractionRunning = false;
const EXTRACTION_TIMEOUT_MS = 30_000;

/**
 * Extract personal facts from a conversation exchange using the LLM.
 * Runs asynchronously — fire and forget. Skips if model is busy or unloaded.
 * Includes a timeout to prevent the lock from being held forever if LLM hangs.
 */
export async function extractMemories(
  userText: string,
  assistantText: string,
  messageId: string,
  lang: Language,
): Promise<void> {
  if (!isLoaded() || extractionRunning) return;
  extractionRunning = true;

  const timeoutId = setTimeout(() => {
    console.warn("[MemoryManager] Extraction timed out, releasing lock");
    extractionRunning = false;
  }, EXTRACTION_TIMEOUT_MS);

  try {
    const systemPrompt =
      lang === "it"
        ? `Estrai fatti personali dall'utente in questa conversazione. Ritorna SOLO un array JSON valido.
Categorie valide: preference, fact, routine, contact_note, topic_interest
Se non ci sono nuovi fatti, ritorna []
Non inventare nulla. Estrai SOLO informazioni esplicitamente dette dall'utente.`
        : `Extract personal facts about the user from this conversation. Return ONLY a valid JSON array.
Valid categories: preference, fact, routine, contact_note, topic_interest
If no new facts, return []
Do not invent anything. Extract ONLY information explicitly stated by the user.`;

    const conversationSnippet = `User: ${userText}\nAssistant: ${assistantText}`;

    const messages: CompletionMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: conversationSnippet },
    ];

    const result = await generate(messages, {
      maxTokens: 512,
      temperature: 0.1,
    });

    const raw = stripThinkTags(result.text);
    const extracted = parseExtractionResult(raw);

    if (extracted.length > 0) {
      await saveExtractedMemories(extracted, messageId);
    }
  } catch (err) {
    console.warn("[MemoryManager] Extraction failed:", err);
  } finally {
    clearTimeout(timeoutId);
    extractionRunning = false;
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

  // Bump access count for all injected memories
  await bumpMemoryAccess(memories.map((m) => m.id));

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
