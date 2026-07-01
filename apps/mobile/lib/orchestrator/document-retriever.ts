// Document retrieval for the query_document tool: embed the query, brute-force
// cosine-rank the stored chunk vectors in TypeScript, and return the top-k text
// (with source citations) for the orchestrator query-loop to ground an answer.
// No sqlite-vec — Expo's SQLite can't load extensions; at personal-document
// scale (a few thousand chunks) a plain in-memory scan is more than fast enough.

import { embed, EMBED_QUERY_PREFIX, EmbeddingModelMissingError } from "../llm/embed-engine";
import { getAllChunks, getDocuments, type StoredChunk } from "../storage/database";
import type { ToolCallResult, Language } from "./types";
import { topKByCosine } from "../documents/similarity";

const TOP_K = 5;
// Relevance floor for L2-normalized nomic cosine. On-topic chunks score well
// above this; unrelated queries fall below it. May need on-device tuning.
const MIN_SCORE = 0.28;

export async function queryDocuments(
  query: string,
  lang: Language,
): Promise<ToolCallResult> {
  let chunks: StoredChunk[];
  try {
    chunks = await getAllChunks();
  } catch (err) {
    return {
      success: false,
      message:
        lang === "it"
          ? "Errore nella lettura dei documenti."
          : "Failed to read your documents.",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (chunks.length === 0) {
    return {
      success: false,
      message:
        lang === "it"
          ? "Non hai ancora importato nessun documento."
          : "You haven't imported any documents yet.",
    };
  }

  let queryVec: Float32Array;
  try {
    const [vec] = await embed([EMBED_QUERY_PREFIX + query]);
    queryVec = vec;
  } catch (err) {
    if (err instanceof EmbeddingModelMissingError) {
      return {
        success: false,
        message:
          lang === "it"
            ? "Nessun modello di embedding installato. Aggiungine uno (es. Nomic Embed) dal gestore modelli per cercare nei documenti."
            : "No embedding model is installed. Add one (e.g. Nomic Embed) from the model manager to search documents.",
        error: "embedding model missing",
      };
    }
    return {
      success: false,
      message:
        lang === "it"
          ? "Errore durante la ricerca nei documenti."
          : "Failed to search your documents.",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const top = topKByCosine(queryVec, chunks, TOP_K);

  // Relevance floor: if even the best match is weak, don't feed unrelated
  // passages to the model (which is told to answer "using ONLY this data" and
  // would otherwise confabulate) — say we found nothing instead.
  if (top.length === 0 || top[0].score < MIN_SCORE) {
    return {
      success: false,
      message:
        lang === "it"
          ? "Non ho trovato nulla di pertinente nei tuoi documenti."
          : "I couldn't find anything relevant in your documents.",
    };
  }

  // Cite the source document + chunk so the model (and user) can see where each
  // passage came from. Language-neutral so the label never forces an English
  // token into a localized answer.
  const docs = await getDocuments();
  const nameById = new Map(docs.map((d) => [d.id, d.filename]));
  const data = top
    .map((r) => {
      const src = nameById.get(r.chunk.documentId) ?? "?";
      return `[${src} #${r.chunk.ordinal + 1}]\n${r.chunk.text}`;
    })
    .join("\n\n");

  return { success: true, message: "", data };
}
