// Embedding engine — a SECOND llama.rn context dedicated to the embedding model
// (nomic-embed), kept separate from the chat context in llm-engine.ts so RAG
// indexing/queries never evict the chat model. nomic is tiny (~90 MB on disk,
// ~0.3 GB resident), so both models coexist comfortably in RAM.

import { initLlama, LlamaContext } from "llama.rn";
import { listInstalled } from "../models/model-registry";

// nomic-embed-text-v1.5 is instruction-tuned: prepend the matching task prefix
// or retrieval quality drops noticeably. Documents and queries use DIFFERENT
// prefixes (asymmetric retrieval).
export const EMBED_DOC_PREFIX = "search_document: ";
export const EMBED_QUERY_PREFIX = "search_query: ";

let embedContext: LlamaContext | null = null;
let loadPromise: Promise<void> | null = null;

// Serialize embedding calls — one context is not safe for concurrent completion.
let embedLock: Promise<void> = Promise.resolve();
function withEmbedLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = embedLock;
  embedLock = next;
  return prev.then(fn).finally(() => release!());
}

export class EmbeddingModelMissingError extends Error {
  constructor() {
    super(
      "No embedding model is installed. Add one (e.g. Nomic Embed) from the model manager to use documents.",
    );
    this.name = "EmbeddingModelMissingError";
  }
}

export function isEmbeddingLoaded(): boolean {
  return embedContext !== null;
}

// The first ready model registered with role 'embedding'.
async function resolveEmbedModelPath(): Promise<string> {
  const installed = await listInstalled();
  const embed = installed.find(
    (m) => m.role === "embedding" && m.state === "ready",
  );
  if (!embed) throw new EmbeddingModelMissingError();
  return embed.filePath;
}

// Lazily initialize the embedding context. Idempotent and race-safe: concurrent
// callers share one in-flight load.
export async function ensureEmbeddingModel(): Promise<void> {
  if (embedContext) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const modelPath = await resolveEmbedModelPath();
    embedContext = await initLlama({
      model: modelPath,
      embedding: true, // put the context in embedding mode
      pooling_type: "mean", // required by nomic/BERT-style embedders
      n_ctx: 2048, // fits a 512-token chunk + the task prefix with headroom
      n_gpu_layers: 0, // CPU, consistent with the chat engine on this hardware
      n_threads: 4,
    });
  })().catch((err) => {
    loadPromise = null; // allow a later retry
    throw err;
  });
  return loadPromise;
}

export async function unloadEmbeddingModel(): Promise<void> {
  if (embedContext) {
    await embedContext.release();
    embedContext = null;
    loadPromise = null;
  }
}

// Embed a batch of already-prefixed texts, returning L2-normalized vectors so
// cosine similarity reduces to a dot product. Callers prepend EMBED_DOC_PREFIX /
// EMBED_QUERY_PREFIX as appropriate.
export async function embed(texts: string[]): Promise<Float32Array[]> {
  await ensureEmbeddingModel();
  return withEmbedLock(async () => {
    if (!embedContext) throw new EmbeddingModelMissingError();
    const out: Float32Array[] = [];
    for (const text of texts) {
      // embd_normalize: 2 = Euclidean (L2) normalization.
      const res = await embedContext.embedding(text, { embd_normalize: 2 });
      out.push(Float32Array.from(res.embedding));
    }
    return out;
  });
}
