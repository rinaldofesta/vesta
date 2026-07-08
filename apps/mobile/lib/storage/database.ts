// SQLite storage layer using expo-sqlite.
// Manages messages, conversations, memories, and config for Vesta.

import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
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

export interface DocumentRecord {
  id: string;
  filename: string;
  mime: string | null;
  sizeBytes: number;
  chunkCount: number;
  createdAt: number;
}

// A chunk with its embedding, as needed by the brute-force cosine retriever.
export interface StoredChunk {
  id: string;
  documentId: string;
  ordinal: number;
  text: string;
  embedding: Float32Array;
}

let db: SQLite.SQLiteDatabase | null = null;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// --- Schema migrations ---
// The baseline tables above use CREATE TABLE IF NOT EXISTS (safe for fresh and
// existing installs). Any change to an EXISTING table (e.g. ADD COLUMN) must go
// through a numbered migration here so upgraded installs converge deterministically
// instead of silently missing columns. Bump SCHEMA_VERSION and append to MIGRATIONS.
// Exported for the migration-chain regression test (migrations.test.ts).
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        hf_repo TEXT,
        hf_file TEXT,
        file_path TEXT NOT NULL,
        quant TEXT,
        size_bytes INTEGER DEFAULT 0,
        min_ram_mb INTEGER,
        chat_template TEXT,
        context_size INTEGER DEFAULT 4096,
        role TEXT NOT NULL DEFAULT 'primary' CHECK(role IN ('primary','router','embedding')),
        state TEXT NOT NULL DEFAULT 'ready'
          CHECK(state IN ('idle','checking','downloading','paused','verifying','ready','error','canceled')),
        resume_token TEXT,
        sha256 TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_models_active ON models(is_active DESC);
    `,
  },
  {
    // Fase 3 (RAG): imported documents and their embedded chunks. Embeddings are
    // stored as raw float32 bytes in a BLOB; retrieval is a brute-force cosine
    // scan in TypeScript (no sqlite-vec — Expo's SQLite can't load extensions).
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        mime TEXT,
        size_bytes INTEGER DEFAULT 0,
        chunk_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        text TEXT NOT NULL,
        token_count INTEGER DEFAULT 0,
        embedding BLOB,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
    `,
  },
  {
    // Fase 6 (MCP): per-client bearer tokens for the local MCP server. Owned
    // here in TS; the native HTTP server only ever sees an in-memory copy.
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS mcp_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_seen INTEGER
      );
    `,
  },
];

// Exported for testing. Applies every migration whose version exceeds the DB's
// current user_version, in ascending order, each in its own transaction.
export async function runMigrations(database: SQLite.SQLiteDatabase): Promise<void> {
  const row = await database.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );
  let current = row?.user_version ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    // Commit schema + version atomically so a crash can't leave a half-applied
    // migration that re-runs on next boot (safe only while migrations are
    // idempotent; future non-idempotent ones depend on this). PRAGMA cannot be
    // parameterized; m.version is a trusted integer literal.
    await database.withTransactionAsync(async () => {
      await database.execAsync(m.sql);
      await database.execAsync(`PRAGMA user_version = ${m.version}`);
    });
    current = m.version;
  }
}

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
    await runMigrations(database);
    db = database;
    return database;
  })().catch((err) => {
    // Reset so future calls can retry instead of returning the rejected promise forever
    dbPromise = null;
    throw err;
  });

  return dbPromise;
}

// On-disk byte size of the database file, for the diagnostics screen.
// expo-sqlite stores databases under documentDirectory/SQLite/.
export async function getDatabaseSizeBytes(): Promise<number> {
  const path = `${FileSystem.documentDirectory}SQLite/vesta.db`;
  const info = await FileSystem.getInfoAsync(path);
  return info.exists ? info.size ?? 0 : 0;
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

// Update a message's tool result after a deferred (confirmed/declined) action.
export async function updateMessageToolResult(
  id: string,
  toolResult: string,
): Promise<void> {
  const d = await getDatabase();
  await d.runAsync(
    "UPDATE messages SET tool_result = ? WHERE id = ?",
    toolResult,
    id,
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

// --- Documents & chunks (RAG) ---

// Embeddings persist as raw little-endian float32 bytes in a BLOB column. These
// helpers copy through fresh buffers so a Float32Array view is always valid,
// regardless of the source array's byteOffset/alignment.
function f32ToBytes(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength).slice();
}

function bytesToF32(bytes: Uint8Array): Float32Array {
  const copy = bytes.slice(); // fresh, 0-offset buffer → safe Float32Array view
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}

export async function saveDocument(doc: {
  id: string;
  filename: string;
  mime?: string | null;
  sizeBytes: number;
  chunkCount: number;
}): Promise<void> {
  const d = await getDatabase();
  await d.runAsync(
    `INSERT OR REPLACE INTO documents (id, filename, mime, size_bytes, chunk_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    doc.id,
    doc.filename,
    doc.mime ?? null,
    doc.sizeBytes,
    doc.chunkCount,
    Date.now(),
  );
}

export async function saveChunks(
  chunks: {
    id: string;
    documentId: string;
    ordinal: number;
    text: string;
    tokenCount: number;
    embedding: Float32Array;
  }[],
): Promise<void> {
  if (chunks.length === 0) return;
  const d = await getDatabase();
  const now = Date.now();
  await d.withTransactionAsync(async () => {
    for (const c of chunks) {
      await d.runAsync(
        `INSERT OR REPLACE INTO chunks (id, document_id, ordinal, text, token_count, embedding, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        c.id,
        c.documentId,
        c.ordinal,
        c.text,
        c.tokenCount,
        f32ToBytes(c.embedding),
        now,
      );
    }
  });
}

export async function getDocuments(): Promise<DocumentRecord[]> {
  const d = await getDatabase();
  const rows = await d.getAllAsync<{
    id: string;
    filename: string;
    mime: string | null;
    size_bytes: number;
    chunk_count: number;
    created_at: number;
  }>(
    `SELECT id, filename, mime, size_bytes, chunk_count, created_at
     FROM documents ORDER BY created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    mime: r.mime,
    sizeBytes: r.size_bytes,
    chunkCount: r.chunk_count,
    createdAt: r.created_at,
  }));
}

// Deletes a document and its chunks atomically.
export async function deleteDocument(id: string): Promise<void> {
  const d = await getDatabase();
  await d.withTransactionAsync(async () => {
    await d.runAsync("DELETE FROM chunks WHERE document_id = ?", id);
    await d.runAsync("DELETE FROM documents WHERE id = ?", id);
  });
}

// Loads every embedded chunk for the brute-force cosine retriever. Personal-scale
// corpora (dozens of docs, a few thousand chunks) fit comfortably in memory.
export async function getAllChunks(): Promise<StoredChunk[]> {
  const d = await getDatabase();
  const rows = await d.getAllAsync<{
    id: string;
    document_id: string;
    ordinal: number;
    text: string;
    embedding: Uint8Array | null;
  }>(`SELECT id, document_id, ordinal, text, embedding FROM chunks`);
  const out: StoredChunk[] = [];
  for (const r of rows) {
    if (!r.embedding) continue;
    out.push({
      id: r.id,
      documentId: r.document_id,
      ordinal: r.ordinal,
      text: r.text,
      embedding: bytesToF32(r.embedding),
    });
  }
  return out;
}

// --- MCP clients (Fase 6) ---

export interface McpClientRow {
  id: string;
  name: string;
  token: string;
  created_at: number;
  last_seen: number | null;
}

export async function insertMcpClient(row: McpClientRow): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "INSERT INTO mcp_clients (id, name, token, created_at, last_seen) VALUES (?, ?, ?, ?, ?)",
    [row.id, row.name, row.token, row.created_at, row.last_seen],
  );
}

export async function selectMcpClients(): Promise<McpClientRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<McpClientRow>(
    "SELECT id, name, token, created_at, last_seen FROM mcp_clients ORDER BY created_at DESC",
  );
}

export async function deleteMcpClient(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM mcp_clients WHERE id = ?", [id]);
}

export async function touchMcpClient(token: string, at: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("UPDATE mcp_clients SET last_seen = ? WHERE token = ?", [at, token]);
}
