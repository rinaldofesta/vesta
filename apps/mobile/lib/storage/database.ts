// SQLite storage layer using expo-sqlite.
// Manages messages, conversations, memories, and config for Vesta.

import * as SQLite from "expo-sqlite";
import type { Message } from "../orchestrator/types";

export interface Conversation {
  id: string;
  title: string | null;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface Memory {
  id: string;
  category: "preference" | "fact" | "routine" | "contact_note" | "topic_interest";
  content: string;
  sourceMessageId: string | null;
  confidence: number;
  accessCount: number;
  createdAt: number;
  lastAccessed: number;
}

export interface KnowledgeFile {
  id: string;
  filename: string;
  fileSize: number;
  createdAt: number;
}

let db: SQLite.SQLiteDatabase | null = null;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const database = await SQLite.openDatabaseAsync("vesta.db");
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool_result')),
        content TEXT NOT NULL,
        tool_call TEXT,
        tool_result TEXT,
        model_used TEXT,
        latency_ms INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id, created_at);

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        message_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_updated
        ON conversations(updated_at DESC);

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL CHECK(category IN ('preference','fact','routine','contact_note','topic_interest')),
        content TEXT NOT NULL,
        source_message_id TEXT,
        confidence REAL DEFAULT 1.0,
        access_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_confidence
        ON memories(confidence DESC);

      CREATE TABLE IF NOT EXISTS knowledge_files (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT OR IGNORE INTO config (key, value) VALUES ('language', 'it');
      INSERT OR IGNORE INTO config (key, value) VALUES ('confirm_destructive_actions', 'true');
    `);
    db = database;
    return database;
  })().catch((err) => {
    // Reset so future calls can retry instead of returning the rejected promise forever
    dbPromise = null;
    throw err;
  });

  return dbPromise;
}

// --- Messages ---

export async function saveMessage(message: Message): Promise<void> {
  const d = await getDatabase();
  await d.runAsync(
    `INSERT INTO messages (id, conversation_id, role, content, tool_call, tool_result, model_used, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    message.id,
    message.conversationId,
    message.role,
    message.content,
    message.toolCall ?? null,
    message.toolResult ?? null,
    message.modelUsed ?? null,
    message.latencyMs ?? null,
    message.createdAt,
  );
}

export async function getMessages(
  conversationId: string,
  limit = 50,
): Promise<Message[]> {
  const d = await getDatabase();
  const rows = await d.getAllAsync<Message>(
    `SELECT id, conversation_id AS conversationId, role, content, tool_call AS toolCall,
            tool_result AS toolResult, model_used AS modelUsed, latency_ms AS latencyMs,
            created_at AS createdAt
     FROM messages
     WHERE conversation_id = ?
     ORDER BY created_at ASC
     LIMIT ?`,
    conversationId,
    limit,
  );
  return rows;
}

export async function deleteConversation(
  conversationId: string,
): Promise<void> {
  const d = await getDatabase();
  await d.runAsync(
    "DELETE FROM messages WHERE conversation_id = ?",
    conversationId,
  );
  await d.runAsync(
    "DELETE FROM conversations WHERE id = ?",
    conversationId,
  );
}

// --- Config ---

export async function getConfig(key: string): Promise<string | null> {
  const d = await getDatabase();
  const row = await d.getFirstAsync<{ value: string }>(
    "SELECT value FROM config WHERE key = ?",
    key,
  );
  return row?.value ?? null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  const d = await getDatabase();
  await d.runAsync(
    "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
    key,
    value,
  );
}

// --- Conversations ---

export async function createConversation(id: string, title?: string): Promise<void> {
  const d = await getDatabase();
  const now = Date.now();
  await d.runAsync(
    `INSERT INTO conversations (id, title, message_count, created_at, updated_at)
     VALUES (?, ?, 0, ?, ?)`,
    id,
    title ?? null,
    now,
    now,
  );
}

export async function getLatestConversation(): Promise<Conversation | null> {
  const d = await getDatabase();
  const row = await d.getFirstAsync<{
    id: string;
    title: string | null;
    message_count: number;
    created_at: number;
    updated_at: number;
  }>(
    `SELECT id, title, message_count, created_at, updated_at
     FROM conversations
     ORDER BY updated_at DESC
     LIMIT 1`,
  );
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAllConversations(): Promise<Conversation[]> {
  const d = await getDatabase();
  const rows = await d.getAllAsync<{
    id: string;
    title: string | null;
    message_count: number;
    created_at: number;
    updated_at: number;
  }>(
    `SELECT id, title, message_count, created_at, updated_at
     FROM conversations
     ORDER BY updated_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    messageCount: r.message_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export interface ConversationWithPreview extends Conversation {
  preview: string | null;
}

export async function getAllConversationsWithPreview(): Promise<ConversationWithPreview[]> {
  const d = await getDatabase();
  const rows = await d.getAllAsync<{
    id: string;
    title: string | null;
    message_count: number;
    created_at: number;
    updated_at: number;
    preview: string | null;
  }>(
    `SELECT c.id, c.title, c.message_count, c.created_at, c.updated_at,
            (SELECT content FROM messages WHERE conversation_id = c.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as preview
     FROM conversations c
     WHERE c.message_count > 0
     ORDER BY c.updated_at DESC
     LIMIT 100`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    messageCount: r.message_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    preview: r.preview,
  }));
}

export async function updateConversationTitle(
  id: string,
  title: string,
): Promise<void> {
  const d = await getDatabase();
  await d.runAsync(
    "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
    title,
    Date.now(),
    id,
  );
}

export async function touchConversation(id: string): Promise<void> {
  const d = await getDatabase();
  await d.runAsync(
    "UPDATE conversations SET message_count = message_count + 1, updated_at = ? WHERE id = ?",
    Date.now(),
    id,
  );
}

// --- Memories ---

export async function saveMemory(memory: {
  id: string;
  category: Memory["category"];
  content: string;
  sourceMessageId?: string;
  confidence?: number;
}): Promise<void> {
  const d = await getDatabase();
  const now = Date.now();
  await d.runAsync(
    `INSERT OR REPLACE INTO memories (id, category, content, source_message_id, confidence, access_count, created_at, last_accessed)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    memory.id,
    memory.category,
    memory.content,
    memory.sourceMessageId ?? null,
    memory.confidence ?? 1.0,
    now,
    now,
  );
}

export async function getAllMemories(): Promise<Memory[]> {
  const d = await getDatabase();
  const rows = await d.getAllAsync<{
    id: string;
    category: Memory["category"];
    content: string;
    source_message_id: string | null;
    confidence: number;
    access_count: number;
    created_at: number;
    last_accessed: number;
  }>(
    `SELECT id, category, content, source_message_id, confidence, access_count, created_at, last_accessed
     FROM memories
     WHERE confidence > 0.1
     ORDER BY confidence DESC, last_accessed DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    content: r.content,
    sourceMessageId: r.source_message_id,
    confidence: r.confidence,
    accessCount: r.access_count,
    createdAt: r.created_at,
    lastAccessed: r.last_accessed,
  }));
}

export async function getTopMemories(limit = 15): Promise<Memory[]> {
  const d = await getDatabase();
  const now = Date.now();
  const rows = await d.getAllAsync<{
    id: string;
    category: Memory["category"];
    content: string;
    source_message_id: string | null;
    confidence: number;
    access_count: number;
    created_at: number;
    last_accessed: number;
  }>(
    `SELECT id, category, content, source_message_id, confidence, access_count, created_at, last_accessed
     FROM memories
     WHERE confidence > 0.2
     ORDER BY (confidence * (1.0 + access_count * 0.1) * (1.0 / (1.0 + (? - last_accessed) / 2592000000.0))) DESC
     LIMIT ?`,
    now,
    limit,
  );
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    content: r.content,
    sourceMessageId: r.source_message_id,
    confidence: r.confidence,
    accessCount: r.access_count,
    createdAt: r.created_at,
    lastAccessed: r.last_accessed,
  }));
}

export async function bumpMemoryAccess(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const d = await getDatabase();
  const placeholders = ids.map(() => "?").join(",");
  await d.runAsync(
    `UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id IN (${placeholders})`,
    Date.now(),
    ...ids,
  );
}

export async function findMemoryByContent(content: string): Promise<Memory | null> {
  const d = await getDatabase();
  // Simple substring search — enough for dedup
  const row = await d.getFirstAsync<{
    id: string;
    category: Memory["category"];
    content: string;
    source_message_id: string | null;
    confidence: number;
    access_count: number;
    created_at: number;
    last_accessed: number;
  }>(
    `SELECT id, category, content, source_message_id, confidence, access_count, created_at, last_accessed
     FROM memories
     WHERE content = ?
     LIMIT 1`,
    content,
  );
  if (!row) return null;
  return {
    id: row.id,
    category: row.category,
    content: row.content,
    sourceMessageId: row.source_message_id,
    confidence: row.confidence,
    accessCount: row.access_count,
    createdAt: row.created_at,
    lastAccessed: row.last_accessed,
  };
}

export async function decayMemories(): Promise<void> {
  const d = await getDatabase();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  // Reduce confidence of memories not accessed in 30 days
  await d.runAsync(
    `UPDATE memories SET confidence = confidence * 0.9
     WHERE last_accessed < ? AND confidence > 0.1`,
    thirtyDaysAgo,
  );
  // Delete very low confidence memories
  await d.runAsync("DELETE FROM memories WHERE confidence <= 0.1");
}

export async function deleteMemory(id: string): Promise<void> {
  const d = await getDatabase();
  await d.runAsync("DELETE FROM memories WHERE id = ?", id);
}

// --- Knowledge Files ---

export async function saveKnowledgeFile(file: {
  id: string;
  filename: string;
  fileSize: number;
}): Promise<void> {
  const d = await getDatabase();
  await d.runAsync(
    `INSERT INTO knowledge_files (id, filename, file_size, created_at)
     VALUES (?, ?, ?, ?)`,
    file.id,
    file.filename,
    file.fileSize,
    Date.now(),
  );
}

export async function getKnowledgeFiles(): Promise<KnowledgeFile[]> {
  const d = await getDatabase();
  const rows = await d.getAllAsync<{
    id: string;
    filename: string;
    file_size: number;
    created_at: number;
  }>(
    `SELECT id, filename, file_size, created_at
     FROM knowledge_files
     ORDER BY created_at ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    fileSize: r.file_size,
    createdAt: r.created_at,
  }));
}

export async function deleteKnowledgeFile(id: string): Promise<void> {
  const d = await getDatabase();
  await d.runAsync("DELETE FROM knowledge_files WHERE id = ?", id);
}
