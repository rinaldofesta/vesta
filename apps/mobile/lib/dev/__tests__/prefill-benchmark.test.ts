// Tests the prefill A/B/C benchmark harness LOGIC (arm order, prompt layouts,
// determinism, stop handling, report math). Actual timings come from the
// device run — generate() is mocked here.

jest.mock("../../llm/llm-engine", () => ({
  clearKvCache: jest.fn(async () => {}),
  generate: jest.fn(),
  getModelInfo: jest.fn(() => ({ loaded: true, path: "file:///m/qwen3-4b.gguf" })),
  isLoaded: jest.fn(() => true),
}));
jest.mock("../../orchestrator/memory-manager", () => ({
  cancelExtraction: jest.fn(),
}));

import { runPrefillBenchmark } from "../prefill-benchmark";
import { clearKvCache, generate } from "../../llm/llm-engine";
import { cancelExtraction } from "../../orchestrator/memory-manager";
import type { CompletionMessage } from "../../llm/llm-engine";

const mockGenerate = generate as jest.MockedFunction<typeof generate>;
const mockClear = clearKvCache as jest.MockedFunction<typeof clearKvCache>;

function result(promptMs: number, opts: { stoppedByUser?: boolean } = {}) {
  return {
    text: "ok",
    reasoningContent: "",
    tokensPredicted: 8,
    tokensEvaluated: 100,
    timings: { promptMs, predictedMs: 10, predictedPerSecond: 20 },
    stoppedByLimit: true,
    stoppedByUser: opts.stoppedByUser ?? false,
  };
}

// The message lists of one arm: calls 6*armIdx .. 6*armIdx+5.
function armCalls(armIdx: number): CompletionMessage[][] {
  return mockGenerate.mock.calls
    .slice(armIdx * 6, armIdx * 6 + 6)
    .map((c) => c[0]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGenerate.mockResolvedValue(result(1000));
});

describe("runPrefillBenchmark", () => {
  test("runs V2, V3, V4 in order, 6 turns each, clearing the KV cache per arm", async () => {
    const report = await runPrefillBenchmark(() => {});

    expect(cancelExtraction).toHaveBeenCalledTimes(1);
    expect(mockClear).toHaveBeenCalledTimes(3);
    expect(mockGenerate).toHaveBeenCalledTimes(18);

    // V2: date context ABOVE the rules/tools in the system prompt.
    for (const msgs of armCalls(0)) {
      const s = msgs[0].content;
      expect(s).toContain("Data e ora corrente:");
      expect(s.indexOf("Data e ora corrente:")).toBeLessThan(s.indexOf("REGOLE:"));
    }
    // V3: date tail at the very END of the system prompt.
    for (const msgs of armCalls(1)) {
      const s = msgs[0].content;
      expect(s).toContain("Contesto temporale corrente:");
      expect(s.indexOf("REGOLE:")).toBeLessThan(
        s.indexOf("Contesto temporale corrente:"),
      );
    }
    // V4: STATIC system prompt (no date at all); date rides in user messages.
    for (const msgs of armCalls(2)) {
      expect(msgs[0].content).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      const users = msgs.filter((m) => m.role === "user");
      for (const u of users) {
        expect(u.content).toMatch(/^\[Contesto temporale: /);
      }
    }

    expect(report).toContain("V2 — data in testa");
    expect(report).toContain("V3 — prefisso stabile");
    expect(report).toContain("V4 — data per turno");
    expect(report).toContain("V4 vs V3 (warm):");
  });

  test("V2/V3 system prompts change every turn; V4's is byte-identical", async () => {
    await runPrefillBenchmark(() => {});
    const systems = (i: number) => armCalls(i).map((m) => m[0].content);

    // +70s per turn crosses a minute boundary every turn.
    expect(new Set(systems(0)).size).toBe(6);
    expect(new Set(systems(1)).size).toBe(6);
    expect(new Set(systems(2)).size).toBe(1);
  });

  test("V4 history replays byte-identically: each turn extends the previous", async () => {
    await runPrefillBenchmark(() => {});
    const v4 = armCalls(2);
    for (let i = 1; i < 6; i++) {
      const prev = v4[i - 1];
      const curr = v4[i];
      // prev = [system, ...pairs, user_i-1]; curr replays prev entirely
      // (user_i-1 now followed by its canned reply) then adds user_i.
      expect(JSON.stringify(curr.slice(0, prev.length))).toBe(
        JSON.stringify(prev),
      );
      expect(curr.length).toBe(prev.length + 2);
    }
  });

  test("user texts are identical across arms (annotation aside)", async () => {
    await runPrefillBenchmark(() => {});
    const lastTurnUsers = (i: number) =>
      armCalls(i)[5]
        .filter((m) => m.role === "user")
        .map((m) => m.content.replace(/^\[[^\]]*\]\n/, ""));
    expect(lastTurnUsers(2)).toEqual(lastTurnUsers(0));
    expect(lastTurnUsers(2)).toEqual(lastTurnUsers(1));
  });

  test("deterministic sampling: temperature 0, tiny n_predict", async () => {
    await runPrefillBenchmark(() => {});
    for (const call of mockGenerate.mock.calls) {
      expect(call[1]).toEqual({ maxTokens: 8, temperature: 0 });
    }
  });

  test("a Stop tap aborts the run instead of reporting corrupted numbers", async () => {
    mockGenerate
      .mockResolvedValueOnce(result(1000))
      .mockResolvedValueOnce(result(900, { stoppedByUser: true }));

    await expect(runPrefillBenchmark(() => {})).rejects.toThrow(/interrotto/i);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });
});
