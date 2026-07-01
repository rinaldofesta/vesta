// Tests the malformed-JSON retry-once-with-correction path in processMessage
// (GAMEPLAN Fase 2 exit gate: "if JSON is malformed, retry once with a
// correction prompt. If still fails, respond as general_chat").
//
// Only the native-touching modules are mocked; response-parser, tool-registry
// and prompt-builder run for real so the retry decision is exercised end-to-end.

import { processMessage } from "../orchestrator";
import { generate } from "../../llm/llm-engine";
import { dispatchToolCall } from "../tool-dispatcher";

jest.mock("../../llm/llm-engine", () => ({
  generate: jest.fn(),
  isLoaded: jest.fn(() => true),
}));
jest.mock("../tool-dispatcher", () => ({
  dispatchToolCall: jest.fn(),
}));
jest.mock("../memory-manager", () => ({
  getMemoriesForPrompt: jest.fn(async () => null),
  extractMemories: jest.fn(async () => {}),
  shouldExtractMemory: jest.fn(() => false),
  cancelExtraction: jest.fn(),
}));
jest.mock("../knowledge-manager", () => ({
  getKnowledgeForPrompt: jest.fn(async () => null),
}));
jest.mock("../../storage/database", () => ({
  getConfig: jest.fn(async () => "true"),
}));

const mockGenerate = generate as jest.MockedFunction<typeof generate>;
const mockDispatch = dispatchToolCall as jest.MockedFunction<typeof dispatchToolCall>;

// Minimal CompletionResult with only `text`/`stoppedByUser` mattering here.
function gen(text: string, opts: { stoppedByUser?: boolean } = {}) {
  return {
    text,
    reasoningContent: "",
    tokensPredicted: 0,
    tokensEvaluated: 0,
    timings: { promptMs: 0, predictedMs: 0, predictedPerSecond: 0 },
    stoppedByLimit: false,
    stoppedByUser: opts.stoppedByUser ?? false,
  };
}

describe("processMessage — malformed-JSON retry-once-with-correction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retries once with a correction prompt, then dispatches the corrected tool call", async () => {
    mockGenerate
      // First pass: truncated tool JSON (looks like a tool attempt, won't parse)
      .mockResolvedValueOnce(gen('{"tool":"set_timer","parameters":{"minutes":'))
      // Correction pass: valid JSON
      .mockResolvedValueOnce(gen('{"tool":"set_timer","parameters":{"minutes":5}}'));
    mockDispatch.mockResolvedValue({
      success: true,
      message: "Timer impostato per 5 minuti",
    });

    const res = await processMessage("timer di 5 minuti", [], "it");

    expect(mockGenerate).toHaveBeenCalledTimes(2);
    // The correction turn must ask for JSON-only.
    const correctionMessages = mockGenerate.mock.calls[1][0];
    expect(JSON.stringify(correctionMessages)).toMatch(/JSON/i);
    expect(res.type).toBe("tool_call");
    if (res.type === "tool_call") {
      expect(res.tool).toBe("set_timer");
      expect(res.parameters).toEqual({ minutes: 5 });
    }
    expect(mockDispatch).toHaveBeenCalledWith("set_timer", { minutes: 5 }, "it");
  });

  it("gates a corrected destructive tool for confirmation", async () => {
    mockGenerate
      .mockResolvedValueOnce(gen('{"tool":"make_call","parameters":{"contact":'))
      .mockResolvedValueOnce(gen('{"tool":"make_call","parameters":{"contact":"Ada"}}'));

    const res = await processMessage("chiama Ada", [], "it");

    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(res.type).toBe("pending_tool_call");
    // Gated: the device is not touched during routing.
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("falls back to general chat when the retry returns plain prose", async () => {
    mockGenerate
      .mockResolvedValueOnce(gen('{"tool":"set_timer","parameters":{"minutes":'))
      .mockResolvedValueOnce(gen("Certo, posso aiutarti a impostare un timer."));

    const res = await processMessage("timer", [], "it");

    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(res).toEqual({
      type: "text",
      content: "Certo, posso aiutarti a impostare un timer.",
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("shows the truncation hint when the retry is still a broken tool attempt", async () => {
    mockGenerate
      .mockResolvedValueOnce(gen('{"tool":"set_alarm","parameters":{"time":"07:'))
      .mockResolvedValueOnce(gen('{"tool":"set_alarm","parameters":{"time":"07:'));

    const res = await processMessage("wake me", [], "en");

    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(res.type).toBe("text");
    if (res.type === "text") {
      expect(res.content).toMatch(/cut off/i);
    }
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("does not retry when the first pass already parses", async () => {
    mockGenerate.mockResolvedValueOnce(
      gen('{"tool":"set_timer","parameters":{"minutes":10}}'),
    );
    mockDispatch.mockResolvedValue({ success: true, message: "ok" });

    const res = await processMessage("timer 10", [], "en");

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(res.type).toBe("tool_call");
  });

  it("does not retry a plain-text (non-tool) reply", async () => {
    mockGenerate.mockResolvedValueOnce(gen("Ciao! Come posso aiutarti?"));

    const res = await processMessage("ciao", [], "it");

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ type: "text", content: "Ciao! Come posso aiutarti?" });
  });

  it("does NOT retry when the user stopped the first pass mid-stream", async () => {
    // A Stop tap makes the first completion resolve early with partial JSON.
    mockGenerate.mockResolvedValueOnce(
      gen('{"tool":"set_timer","parameters":{"minutes":', {
        stoppedByUser: true,
      }),
    );

    const res = await processMessage("timer di 5 minuti", [], "it");

    // No correction pass — the user asked to stop.
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(res.type).toBe("text");
    if (res.type === "text") expect(res.content).toMatch(/troncata/i);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("shows the hint (not a blank bubble) when the retry returns empty output", async () => {
    mockGenerate
      .mockResolvedValueOnce(gen('{"tool":"set_timer","parameters":{"minutes":'))
      .mockResolvedValueOnce(gen("   ")); // whitespace-only retry

    const res = await processMessage("timer", [], "it");

    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(res.type).toBe("text");
    if (res.type === "text") expect(res.content).toMatch(/troncata/i);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
