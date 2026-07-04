// Pure helpers in llm-engine used by the session cache: the stable/volatile
// token-boundary search (commonPrefixLength) and the ctx_shift guard's
// estimator (estimatePromptTokens, shared with memory extraction).

// llm-engine imports llama.rn at module load; none of its native surface is
// exercised here.
jest.mock("llama.rn", () => ({
  initLlama: jest.fn(),
  loadLlamaModelInfo: jest.fn(),
}));

import { commonPrefixLength, estimatePromptTokens } from "../llm-engine";

describe("commonPrefixLength", () => {
  test("stops at the first diverging token", () => {
    expect(commonPrefixLength([1, 2, 3, 4], [1, 2, 9, 4])).toBe(2);
  });

  test("identical arrays share their full length", () => {
    expect(commonPrefixLength([5, 6, 7], [5, 6, 7])).toBe(3);
  });

  test("one array being a prefix of the other is bounded by the shorter", () => {
    expect(commonPrefixLength([1, 2], [1, 2, 3, 4])).toBe(2);
    expect(commonPrefixLength([1, 2, 3, 4], [1, 2])).toBe(2);
  });

  test("divergence at token 0 and empty inputs", () => {
    expect(commonPrefixLength([9], [1])).toBe(0);
    expect(commonPrefixLength([], [1, 2])).toBe(0);
  });
});

describe("estimatePromptTokens", () => {
  test("~3 chars/token plus per-message template overhead", () => {
    // 3 chars → 1 token + 8 overhead
    expect(estimatePromptTokens([{ role: "user", content: "abc" }])).toBe(9);
    // 7 chars → ceil(7/3)=3 + 8 = 11; two messages sum
    expect(
      estimatePromptTokens([
        { role: "user", content: "abc" },
        { role: "assistant", content: "1234567" },
      ]),
    ).toBe(20);
    expect(estimatePromptTokens([])).toBe(0);
  });
});
