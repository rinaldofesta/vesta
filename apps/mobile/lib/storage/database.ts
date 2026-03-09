// SQLite storage layer using expo-sqlite.
// Manages messages and config for the Vesta MVP.

import * as SQLite from "expo-sqlite";
import type { Message } from "../orchestrator/types";

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

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT OR IGNORE INTO config (key, value) VALUES ('language', 'it');
      INSERT OR IGNORE INTO config (key, value) VALUES ('confirm_destructive_actions', 'true');
    `);
    db = database;
    return database;
  })();

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
