import { chunkText, estimateTokens } from "../chunker";

describe("chunkText", () => {
  it("returns no chunks for empty or whitespace input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("keeps short text as a single chunk", () => {
    const chunks = chunkText("Hello world. This is short.");
    expect(chunks).toEqual([
      { ordinal: 0, text: "Hello world. This is short." },
    ]);
  });

  it("splits long text into multiple, sequentially-numbered chunks", () => {
    const para = "word ".repeat(200).trim(); // ~1000 chars
    const text = [para, para, para].join("\n\n"); // ~3000 chars
    const chunks = chunkText(text, { maxChars: 1200, overlapChars: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => expect(c.ordinal).toBe(i));
  });

  it("carries a tail of the previous chunk as overlap", () => {
    const a = "AAAA ".repeat(100).trim();
    const b = "BBBB ".repeat(100).trim();
    const chunks = chunkText([a, b].join("\n\n"), {
      maxChars: 550,
      overlapChars: 50,
    });
    expect(chunks.length).toBeGreaterThan(1);
    // The second chunk should begin with overlap carried from the first (A's).
    expect(chunks[1].text).toContain("AAAA");
  });

  it("hard-splits a single paragraph longer than maxChars", () => {
    const huge = "x".repeat(5000);
    const chunks = chunkText(huge, { maxChars: 1000, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    chunks.forEach((c) => expect(c.text.length).toBeLessThanOrEqual(1000));
  });
});

describe("estimateTokens", () => {
  it("approximates ~4 chars per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});
