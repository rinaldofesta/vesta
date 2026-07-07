// Locks THE V4 invariant end-to-end at the orchestrator level: the message
// list sent to the LLM for turn N+1 must begin with the EXACT bytes of the
// list sent for turn N (system prompt + all replayed history), even when the
// wall clock crossed minute/day boundaries in between. llama.rn reuses the KV
// cache for the longest common token prefix, so any byte drift here silently
// re-prefills the whole conversation (~30s+ on device).
//
// generate() is mocked to capture the exact messages; prompt-builder and
// tool-registry run for real.

import { processMessage, historyWindowStart } from "../orchestrator";
import { generate } from "../../llm/llm-engine";
import type { CompletionMessage } from "../../llm/llm-engine";
import type { Message } from "../types";

jest.mock("../../llm/llm-engine", () => ({
  generate: jest.fn(),
  isLoaded: jest.fn(() => true),
  estimatePromptTokens: jest.fn(() => 0),
  getContextSize: jest.fn(() => 4096),
}));
jest.mock("../tool-dispatcher", () => ({
  dispatchToolCall: jest.fn(),
}));
jest.mock("../memory-manager", () => ({
  getMemoriesForPrompt: jest.fn(async () => "- (fact) ama il caffè"),
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
jest.mock("../session-warmer", () => ({
  schedulePrefixPersist: jest.fn(),
}));

const mockGenerate = generate as jest.MockedFunction<typeof generate>;

function gen(text: string) {
  return {
    text,
    reasoningContent: "",
    tokensPredicted: 10,
    tokensEvaluated: 100,
    timings: { promptMs: 0, predictedMs: 0, predictedPerSecond: 0 },
    stoppedByLimit: false,
    stoppedByUser: false,
  };
}

function userMsg(id: string, content: string, createdAt: number): Message {
  return { id, conversationId: "c1", role: "user", content, createdAt };
}
function assistantMsg(id: string, content: string, createdAt: number): Message {
  return { id, conversationId: "c1", role: "assistant", content, createdAt };
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("V4 history byte-stability across turns", () => {
  test("turn N+1's prompt begins with turn N's prompt bytes despite clock drift", async () => {
    mockGenerate.mockResolvedValue(gen("Ciao! Come posso aiutarti?"));

    // Turn 1: sent at 22:41 on July 1st.
    const t1 = new Date(2026, 6, 1, 22, 41, 12);
    jest.useFakeTimers().setSystemTime(t1);
    await processMessage("ciao", [], "it", undefined, undefined, t1);
    const turn1: CompletionMessage[] = mockGenerate.mock.calls[0][0];

    // Turn 2: the clock has crossed a minute, an hour, and a DAY boundary.
    // History replays turn 1 from its stored createdAt.
    const t2 = new Date(2026, 6, 2, 9, 5, 44);
    jest.setSystemTime(t2);
    const history = [
      userMsg("m1", "ciao", t1.getTime()),
      assistantMsg("m2", "Ciao! Come posso aiutarti?", t1.getTime() + 8000),
    ];
    await processMessage("che tempo fa", history, "it", undefined, undefined, t2);
    const turn2: CompletionMessage[] = mockGenerate.mock.calls[1][0];

    // The V4 invariant: everything turn 1 sent is a byte-identical prefix of
    // what turn 2 sends. One JSON-encoded comparison catches role and content.
    expect(turn2.length).toBe(turn1.length + 2);
    expect(JSON.stringify(turn2.slice(0, turn1.length))).toBe(
      JSON.stringify(turn1),
    );

    // The system prompt is static and the dates live in the user messages.
    expect(turn2[0].role).toBe("system");
    expect(turn2[0].content).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(turn1[1].content).toContain("[Contesto temporale: mercoledì 2026-07-01T22:41");
    expect(turn2[3].content).toContain("[Contesto temporale: giovedì 2026-07-02T09:05");
  });

  test("the current user text appears exactly once in the prompt", async () => {
    // Regression: chat-store used to pass post-append state as history while
    // processMessage appended the text again — the model saw it twice.
    mockGenerate.mockResolvedValue(gen("ok"));
    const t = new Date(2026, 6, 1, 10, 0, 0);
    await processMessage("solo una volta", [], "it", undefined, undefined, t);
    const messages: CompletionMessage[] = mockGenerate.mock.calls[0][0];
    const hits = messages.filter((m) => m.content.includes("solo una volta"));
    expect(hits).toHaveLength(1);
    expect(messages).toHaveLength(2); // system + the one user message
  });
});

describe("historyWindowStart — anchored sliding window", () => {
  test("keeps the whole history until it exceeds the 20-message window", () => {
    for (let n = 0; n <= 20; n++) expect(historyWindowStart(n)).toBe(0);
  });

  test("advances only on stride boundaries, staying constant in between", () => {
    // 21..27 still start at 0 (window grows up to 27); then it jumps by 8.
    expect(historyWindowStart(21)).toBe(0);
    expect(historyWindowStart(27)).toBe(0);
    expect(historyWindowStart(28)).toBe(8);
    expect(historyWindowStart(35)).toBe(8);
    expect(historyWindowStart(36)).toBe(16);
  });

  test("the start is always a stride multiple (never advances mid-stride)", () => {
    for (let n = 0; n < 500; n++) expect(historyWindowStart(n) % 8).toBe(0);
  });
});

describe("V4 byte-stability holds on long conversations (anchored window)", () => {
  test("consecutive turns within a stride bucket stay a pure append", async () => {
    mockGenerate.mockResolvedValue(gen("risposta"));
    const base = new Date(2026, 6, 1, 12, 0, 0).getTime();

    // 30 messages (15 turns) — past the window, so a naive slice(-20) would
    // re-prefill every turn. historyWindowStart(30) and (32) both anchor to 8.
    const history30: Message[] = [];
    for (let i = 0; i < 15; i++) {
      const t = base + i * 600_000;
      history30.push(userMsg(`u${i}`, `domanda ${i}`, t));
      history30.push(assistantMsg(`a${i}`, `risposta ${i}`, t + 5000));
    }

    const tA = new Date(base + 15 * 600_000);
    await processMessage("qA", history30, "it", undefined, undefined, tA);
    const promptA: CompletionMessage[] = mockGenerate.mock.calls[0][0];

    // Turn B's history includes turn A's own user+assistant messages; the user
    // message replays from its stored createdAt = tA (the V4 invariant).
    const history32: Message[] = [
      ...history30,
      userMsg("uA", "qA", tA.getTime()),
      assistantMsg("aA", "risposta", tA.getTime() + 5000),
    ];
    const tB = new Date(base + 16 * 600_000);
    await processMessage("qB", history32, "it", undefined, undefined, tB);
    const promptB: CompletionMessage[] = mockGenerate.mock.calls[1][0];

    expect(historyWindowStart(30)).toBe(8);
    expect(historyWindowStart(32)).toBe(8);
    // Everything turn A sent is a byte-identical prefix of turn B — a pure
    // append despite both being well past the 20-message window.
    expect(JSON.stringify(promptB.slice(0, promptA.length))).toBe(
      JSON.stringify(promptA),
    );
  });
});
