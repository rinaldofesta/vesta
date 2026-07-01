// Splits document text into overlapping chunks for embedding + retrieval.
// Sizing is character-based (~4 chars/token), which is accurate enough for RAG
// and keeps this module pure and dependency-free (unit-testable, no llama.rn).

export interface ChunkOptions {
  maxChars?: number; // target chunk size (~512 tokens ≈ 2000 chars)
  overlapChars?: number; // overlap carried between adjacent chunks (~64 tokens)
}

export interface TextChunk {
  ordinal: number;
  text: string;
}

const DEFAULT_MAX_CHARS = 2000;
const DEFAULT_OVERLAP_CHARS = 256;

// Approximate token count (~4 chars/token) — good enough for progress + storage.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Hard-splits an over-long paragraph on word boundaries near maxChars.
function splitLong(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(" ", end);
      if (lastSpace > start + maxChars * 0.5) end = lastSpace;
    }
    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end;
  }
  return out;
}

export function chunkText(input: string, opts: ChunkOptions = {}): TextChunk[] {
  const maxChars = Math.max(1, opts.maxChars ?? DEFAULT_MAX_CHARS);
  const overlap = Math.min(
    Math.max(0, opts.overlapChars ?? DEFAULT_OVERLAP_CHARS),
    maxChars - 1,
  );

  const text = input.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  // Paragraph-aware: split on blank lines, then pack paragraphs into chunks.
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) pieces.push(para);
    else pieces.push(...splitLong(para, maxChars));
  }

  const packed: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + 2 + piece.length > maxChars) {
      packed.push(current);
      current = piece;
    } else {
      current = current ? current + "\n\n" + piece : piece;
    }
  }
  if (current) packed.push(current);

  // Carry a tail of the previous chunk into each chunk so retrieval doesn't miss
  // facts that straddle a boundary.
  const withOverlap =
    overlap === 0
      ? packed
      : packed.map((chunk, i) => {
          if (i === 0) return chunk;
          const prev = packed[i - 1];
          const tail = prev.slice(Math.max(0, prev.length - overlap)).trimStart();
          return tail + "\n\n" + chunk;
        });

  return withOverlap.map((chunkTextValue, ordinal) => ({
    ordinal,
    text: chunkTextValue,
  }));
}
