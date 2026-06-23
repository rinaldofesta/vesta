// Pure knowledge-injection helpers, kept dependency-free so they're unit-testable
// without pulling in expo-file-system / uuid.

// ~4000 chars ≈ ~1200 tokens, leaving room for history + the response in a
// 4096-token window.
export const MAX_KNOWLEDGE_INJECT_CHARS = 4000;

// Hard-cap injected knowledge so a large store can never overflow the context.
// Truncates on a line boundary near the limit and appends a visible notice.
export function capInjectedKnowledge(
  block: string,
  max = MAX_KNOWLEDGE_INJECT_CHARS,
): string {
  if (block.length <= max) return block;
  const notice = "\n\n[...knowledge truncated to fit the context window]";
  // If there's no room for content + notice, hard-truncate to max so the result
  // never exceeds the budget (the notice itself can be longer than a tiny max).
  if (max <= notice.length) return block.slice(0, max);
  const budget = max - notice.length;
  let cut = block.lastIndexOf("\n", budget);
  if (cut < budget * 0.5) cut = budget; // no nearby newline — hard cut
  return block.slice(0, cut).trimEnd() + notice;
}
