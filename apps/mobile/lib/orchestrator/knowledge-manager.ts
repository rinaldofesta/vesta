// Knowledge Manager — loads user-uploaded .md files as persistent context.
// Like Anthropic's portable memory: structured personal context injected into every prompt.

import * as FileSystem from "expo-file-system/legacy";
import { v4 as uuid } from "uuid";
import {
  saveKnowledgeFile,
  getKnowledgeFiles,
  deleteKnowledgeFile as dbDeleteKnowledgeFile,
} from "../storage/database";
import type { KnowledgeFile } from "../storage/database";
import { capInjectedKnowledge } from "./knowledge-format";

export {
  capInjectedKnowledge,
  MAX_KNOWLEDGE_INJECT_CHARS,
} from "./knowledge-format";

const KNOWLEDGE_DIR = FileSystem.documentDirectory + "knowledge/";

// Reject oversized files at import (a huge .md can't usefully fit a 4096-token
// context anyway). The total injected text is hard-capped separately at prompt
// build time (capInjectedKnowledge), so the window can never overflow.
export const MAX_KNOWLEDGE_FILE_BYTES = 64 * 1024;

export class KnowledgeTooLargeError extends Error {
  constructor() {
    super(
      `File is too large (max ${Math.round(MAX_KNOWLEDGE_FILE_BYTES / 1024)} KB). ` +
        `Knowledge files are injected into every prompt, so keep them short.`,
    );
    this.name = "KnowledgeTooLargeError";
  }
}

async function ensureKnowledgeDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(KNOWLEDGE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(KNOWLEDGE_DIR, { intermediates: true });
  }
}

/**
 * Import a .md file from a URI (content:// or file://) into the knowledge store.
 * Returns the created KnowledgeFile record.
 */
export async function importKnowledgeFile(
  sourceUri: string,
  filename: string,
): Promise<KnowledgeFile> {
  await ensureKnowledgeDir();

  const id = uuid();
  const destPath = KNOWLEDGE_DIR + id + ".md";

  await FileSystem.copyAsync({ from: sourceUri, to: destPath });

  const info = await FileSystem.getInfoAsync(destPath);
  const fileSize = info.exists && !info.isDirectory ? (info.size ?? 0) : 0;

  // Reject oversized files (delete the copy first so we don't leave an orphan).
  if (fileSize > MAX_KNOWLEDGE_FILE_BYTES) {
    await FileSystem.deleteAsync(destPath, { idempotent: true });
    throw new KnowledgeTooLargeError();
  }

  await saveKnowledgeFile({ id, filename, fileSize });

  return {
    id,
    filename,
    fileSize,
    createdAt: Date.now(),
  };
}

/**
 * Delete a knowledge file from disk and database.
 */
export async function removeKnowledgeFile(id: string): Promise<void> {
  const filePath = KNOWLEDGE_DIR + id + ".md";
  const info = await FileSystem.getInfoAsync(filePath);
  if (info.exists) {
    await FileSystem.deleteAsync(filePath, { idempotent: true });
  }
  await dbDeleteKnowledgeFile(id);
}

/**
 * Load all knowledge file contents and return as a formatted block for prompt injection.
 * Returns null if no files are uploaded.
 */
export async function getKnowledgeForPrompt(): Promise<string | null> {
  const files = await getKnowledgeFiles();
  if (files.length === 0) return null;

  const sections: string[] = [];

  for (const file of files) {
    const filePath = KNOWLEDGE_DIR + file.id + ".md";
    try {
      const content = await FileSystem.readAsStringAsync(filePath);
      if (content.trim()) {
        sections.push(`### ${file.filename}\n${content.trim()}`);
      }
    } catch (err) {
      console.warn(`[KnowledgeManager] Failed to read ${file.filename}:`, err);
    }
  }

  if (sections.length === 0) return null;
  return capInjectedKnowledge(sections.join("\n\n"));
}

/**
 * List all uploaded knowledge files (for settings UI).
 */
export async function listKnowledgeFiles(): Promise<KnowledgeFile[]> {
  return getKnowledgeFiles();
}
