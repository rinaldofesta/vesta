// Pure vector-similarity helpers for document retrieval — no native/DB imports
// at runtime (the StoredChunk import is a type, erased at compile time), so these
// are unit-testable in isolation.

import type { StoredChunk } from "../storage/database";

// Dot product. With L2-normalized embeddings this equals cosine similarity.
export function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

export interface RankedChunk {
  chunk: StoredChunk;
  score: number;
}

// Rank chunks by cosine similarity to the query vector, highest first, top k.
export function topKByCosine(
  queryVec: Float32Array,
  chunks: StoredChunk[],
  k: number,
): RankedChunk[] {
  const scored = chunks.map((chunk) => ({
    chunk,
    score: dot(queryVec, chunk.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
