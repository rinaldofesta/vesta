// Tests the session-warmer glue: the ctx_shift guard on persist scheduling
// and the probe tails handed to the cache. prompt-builder runs for real so
// the probes are the production tail format.

jest.mock("../../llm/llm-engine", () => ({
  // Real-shaped estimator: ~3 chars/token + 8/message (mirrors llm-engine).
  estimatePromptTokens: jest.fn((msgs: Array<{ content: string }>) =>
    msgs.reduce((n, m) => n + Math.ceil(m.content.length / 3) + 8, 0),
  ),
  getContextSize: jest.fn(() => 4096),
}));
jest.mock("../../llm/session-cache", () => ({
  persistPrefixSession: jest.fn(async () => 1456),
  restorePrefixSession: jest.fn(async () => null),
}));
jest.mock("../memory-manager", () => ({
  getMemoriesForPrompt: jest.fn(async () => null),
}));
jest.mock("../knowledge-manager", () => ({
  getKnowledgeForPrompt: jest.fn(async () => null),
}));
jest.mock("../../storage/database", () => ({
  getConfig: jest.fn(async () => "it"),
}));

import { schedulePrefixPersist, warmSessionCache } from "../session-warmer";
import {
  persistPrefixSession,
  restorePrefixSession,
} from "../../llm/session-cache";
import { getContextSize } from "../../llm/llm-engine";

const mockPersist = persistPrefixSession as jest.MockedFunction<
  typeof persistPrefixSession
>;
const mockRestore = restorePrefixSession as jest.MockedFunction<
  typeof restorePrefixSession
>;
const mockCtx = getContextSize as jest.MockedFunction<typeof getContextSize>;

beforeEach(() => {
  jest.clearAllMocks();
  mockCtx.mockReturnValue(4096);
});

describe("schedulePrefixPersist", () => {
  const SMALL_TURN = [
    { role: "system" as const, content: "prefix + tail" },
    { role: "user" as const, content: "ciao" },
  ];

  test("persists with two DIVERGING probe user messages in production format", () => {
    schedulePrefixPersist("STABLE PREFIX", "it", SMALL_TURN, 50);

    expect(mockPersist).toHaveBeenCalledTimes(1);
    const [prefix, probeA, probeB] = mockPersist.mock.calls[0];
    expect(prefix).toBe("STABLE PREFIX");
    // V4: probes are annotated first-user-messages, not system tails.
    expect(probeA).toMatch(/^\[Contesto temporale: /);
    expect(probeB).toMatch(/^\[Contesto temporale: /);
    // The boundary search needs the probes to differ.
    expect(probeA).not.toBe(probeB);
  });

  test("skips when the turn may have ctx_shifted the prefix out", () => {
    // ~4000 estimated prompt tokens + 500 generated ≈ n_ctx → unsafe.
    const bigTurn = [
      { role: "system" as const, content: "x".repeat(12_000) },
      { role: "user" as const, content: "y".repeat(20) },
    ];
    schedulePrefixPersist("STABLE PREFIX", "it", bigTurn, 500);
    expect(mockPersist).not.toHaveBeenCalled();
  });

  test("a rejected persist is swallowed (fire-and-forget must never throw)", async () => {
    mockPersist.mockRejectedValueOnce(new Error("disk full"));
    expect(() =>
      schedulePrefixPersist("STABLE PREFIX", "it", SMALL_TURN, 50),
    ).not.toThrow();
    // Let the rejection propagate through the .catch handler.
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("warmSessionCache", () => {
  test("builds the production stable prefix and hands it to restore", async () => {
    await warmSessionCache();
    expect(mockRestore).toHaveBeenCalledTimes(1);
    const prefix = mockRestore.mock.calls[0][0];
    // Italian persona (language config mocked to "it"), tools included, and
    // strictly time-free — the same invariants prompt-builder.test.ts locks.
    expect(prefix).toContain("Sei Vesta");
    expect(prefix).toContain("Strumenti disponibili:");
    expect(prefix).not.toContain("Contesto temporale corrente:");
  });

  test("restore failure is non-fatal (starts cold)", async () => {
    mockRestore.mockRejectedValueOnce(new Error("io error"));
    await expect(warmSessionCache()).resolves.toBeUndefined();
  });
});
