// Tests the prefill A/B benchmark harness LOGIC (arm order, prompt layouts,
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

beforeEach(() => {
  jest.clearAllMocks();
  mockGenerate.mockResolvedValue(result(1000));
});

describe("runPrefillBenchmark", () => {
  test("runs V2 first then V3, 6 turns each, clearing the KV cache per arm", async () => {
    const report = await runPrefillBenchmark(() => {});

    expect(cancelExtraction).toHaveBeenCalledTimes(1);
    expect(mockClear).toHaveBeenCalledTimes(2);
    expect(mockGenerate).toHaveBeenCalledTimes(12);

    // Arm order: the first 6 system prompts are the frozen V2 layout (date
    // context ABOVE the rules/tools), the last 6 the V3 stable-prefix layout
    // (date-only tail at the very end).
    const systems = mockGenerate.mock.calls.map((c) => c[0][0].content);
    for (const s of systems.slice(0, 6)) {
      expect(s).toContain("Data e ora corrente:");
      expect(s.indexOf("Data e ora corrente:")).toBeLessThan(s.indexOf("REGOLE:"));
    }
    for (const s of systems.slice(6)) {
      expect(s).toContain("Contesto temporale corrente:");
      expect(s.indexOf("REGOLE:")).toBeLessThan(
        s.indexOf("Contesto temporale corrente:"),
      );
    }

    expect(report).toContain("V2 — data in testa");
    expect(report).toContain("V3 — prefisso stabile");
    expect(report).toContain("Media turni 2-6");
  });

  test("the injected clock changes the prompt every turn, identically across arms", async () => {
    await runPrefillBenchmark(() => {});
    const systems = mockGenerate.mock.calls.map((c) => c[0][0].content);
    const v2 = systems.slice(0, 6);
    const v3 = systems.slice(6);

    // +70s per turn crosses a minute boundary every turn in both layouts.
    expect(new Set(v2).size).toBe(6);
    expect(new Set(v3).size).toBe(6);

    // Byte-identical history/user content across arms: only the system prompt
    // differs between paired turns.
    for (let i = 0; i < 6; i++) {
      const restV2 = JSON.stringify(mockGenerate.mock.calls[i][0].slice(1));
      const restV3 = JSON.stringify(mockGenerate.mock.calls[6 + i][0].slice(1));
      expect(restV2).toBe(restV3);
    }
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
