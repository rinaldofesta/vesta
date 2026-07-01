// Document ingestion pipeline: parse → chunk → embed (batched, with progress) →
// store. Chunks + embeddings are self-sufficient for retrieval, so the original
// file is not retained. Requires an embedding model (nomic) to be installed.

import { v4 as uuid } from "uuid";
import { parseDocument } from "./parsers";
import { chunkText, estimateTokens } from "./chunker";
import { embed, EMBED_DOC_PREFIX } from "../llm/embed-engine";
import {
  saveDocument,
  saveChunks,
  getDocuments,
  deleteDocument as dbDeleteDocument,
  type DocumentRecord,
} from "../storage/database";

export interface IndexProgress {
  phase: "parsing" | "embedding" | "saving";
  done: number;
  total: number;
}

// Embed this many chunks per llama.rn round-trip.
const EMBED_BATCH = 8;

export class EmptyDocumentError extends Error {
  constructor() {
    super("No readable text was found in this document.");
    this.name = "EmptyDocumentError";
  }
}

export async function importAndIndexDocument(
  sourceUri: string,
  filename: string,
  mime: string | null,
  sizeBytes: number,
  onProgress?: (p: IndexProgress) => void,
): Promise<DocumentRecord> {
  onProgress?.({ phase: "parsing", done: 0, total: 1 });
  const text = await parseDocument(sourceUri, filename, mime);
  if (!text.trim()) throw new EmptyDocumentError();

  const chunks = chunkText(text);
  if (chunks.length === 0) throw new EmptyDocumentError();

  const docId = uuid();
  const stored: {
    id: string;
    documentId: string;
    ordinal: number;
    text: string;
    tokenCount: number;
    embedding: Float32Array;
  }[] = [];

  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vecs = await embed(batch.map((c) => EMBED_DOC_PREFIX + c.text));
    batch.forEach((c, j) => {
      stored.push({
        id: uuid(),
        documentId: docId,
        ordinal: c.ordinal,
        text: c.text,
        tokenCount: estimateTokens(c.text),
        embedding: vecs[j],
      });
    });
    onProgress?.({
      phase: "embedding",
      done: Math.min(i + EMBED_BATCH, chunks.length),
      total: chunks.length,
    });
  }

  onProgress?.({ phase: "saving", done: 0, total: 1 });
  await saveDocument({
    id: docId,
    filename,
    mime,
    sizeBytes,
    chunkCount: stored.length,
  });
  await saveChunks(stored);

  return {
    id: docId,
    filename,
    mime,
    sizeBytes,
    chunkCount: stored.length,
    createdAt: Date.now(),
  };
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  return getDocuments();
}

export async function removeDocument(id: string): Promise<void> {
  return dbDeleteDocument(id);
}
