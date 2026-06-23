// Pure gate for memory extraction, kept dependency-free so it is unit-testable
// without pulling in the LLM engine / native modules.
//
// Avoids the expensive second LLM pass on turns that can't yield a useful
// personal fact (ORCH-1 / ORCH-12). Tool-call turns produce a canned
// confirmation ("Done!"), and very short messages are greetings/acks.

const MIN_EXTRACTION_CHARS = 12;

export function shouldExtractMemory(
  userText: string,
  isToolCall: boolean,
): boolean {
  if (isToolCall) return false;
  return userText.trim().length >= MIN_EXTRACTION_CHARS;
}
