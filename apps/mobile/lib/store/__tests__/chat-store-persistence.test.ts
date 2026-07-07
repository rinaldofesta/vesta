// Regression tests for the silent-failure class (Fase 5): a persistence write
// that fails used to only console.error, so a message/reply lost from SQLite
// vanished on restart with no user signal. Now every persistence catch routes
// through notePersistFailure → the `notice` channel, and a model that fails to
// load at startup surfaces a real notice instead of the misleading "no model"
// banner. These assert the NOTICE is set — they fail on the pre-fix code that
// only logged.
//
// The store pulls in the whole native stack (orchestrator, SQLite, llama.rn
// engine, model registry, file system); all of it is mocked so the store's own
// control flow is what's under test. `./notices` runs for real so we assert the
// actual localized strings.

import { useChatStore } from "../chat-store";
import { persistFailureNotice, modelLoadFailureNotice } from "../notices";
import {
  saveMessage,
  updateMessageToolResult,
  getLatestConversation,
} from "../../storage/database";
import { processMessage } from "../../orchestrator/orchestrator";
import { loadModel, isLoaded, getModelInfo } from "../../llm/llm-engine";
import { getActiveModel } from "../../models/model-registry";
import * as FileSystem from "expo-file-system/legacy";

jest.mock("uuid", () => {
  let n = 0;
  return { v4: () => `id-${++n}` };
});

jest.mock("../../orchestrator/orchestrator", () => ({
  processMessage: jest.fn(async () => ({ type: "text", content: "ok" })),
  executeToolCall: jest.fn(async () => ({ success: true, message: "done" })),
}));

jest.mock("../../storage/database", () => ({
  saveMessage: jest.fn(async () => {}),
  getMessages: jest.fn(async () => []),
  getConfig: jest.fn(async () => "it"),
  setConfig: jest.fn(async () => {}),
  createConversation: jest.fn(async () => {}),
  getLatestConversation: jest.fn(async () => null),
  updateConversationTitle: jest.fn(async () => {}),
  touchConversation: jest.fn(async () => {}),
  deleteConversation: jest.fn(async () => {}),
  updateMessageToolResult: jest.fn(async () => {}),
}));

jest.mock("../../llm/llm-engine", () => ({
  loadModel: jest.fn(async () => {}),
  isLoaded: jest.fn(() => false),
  getModelInfo: jest.fn(() => ({ loaded: false, path: undefined })),
  stopGeneration: jest.fn(async () => {}),
}));

jest.mock("../../llm/perf-config", () => ({
  getPerfSettings: jest.fn(async () => ({})),
  perfToLlmOptions: jest.fn(() => ({})),
}));

jest.mock("../../orchestrator/memory-manager", () => ({
  runMemoryDecay: jest.fn(async () => {}),
}));

jest.mock("../../orchestrator/session-warmer", () => ({
  warmSessionCache: jest.fn(async () => {}),
}));

jest.mock("../../llm/session-cache", () => ({
  clearPrefixSessionCache: jest.fn(async () => {}),
}));

jest.mock("../../native/vesta-service", () => ({
  startVestaService: jest.fn(async () => {}),
}));

jest.mock("expo-file-system/legacy", () => ({
  getInfoAsync: jest.fn(async () => ({ exists: true })),
}));

jest.mock("../../models/model-registry", () => ({
  ensureLegacyMigration: jest.fn(async () => {}),
  getActiveModel: jest.fn(async () => null),
  setModelState: jest.fn(async () => {}),
}));

const mockSaveMessage = saveMessage as jest.MockedFunction<typeof saveMessage>;
const mockUpdateToolResult = updateMessageToolResult as jest.MockedFunction<
  typeof updateMessageToolResult
>;
const mockGetLatest = getLatestConversation as jest.MockedFunction<
  typeof getLatestConversation
>;
const mockProcess = processMessage as jest.MockedFunction<typeof processMessage>;
const mockLoadModel = loadModel as jest.MockedFunction<typeof loadModel>;
const mockIsLoaded = isLoaded as jest.MockedFunction<typeof isLoaded>;
const mockGetModelInfo = getModelInfo as jest.MockedFunction<typeof getModelInfo>;
const mockGetActiveModel = getActiveModel as jest.MockedFunction<typeof getActiveModel>;
const mockGetInfoAsync = FileSystem.getInfoAsync as jest.MockedFunction<
  typeof FileSystem.getInfoAsync
>;

function resetStore() {
  useChatStore.setState({
    messages: [],
    conversationId: "conv-1",
    conversationTitle: null,
    language: "it",
    isGenerating: false,
    streamingText: "",
    modelLoaded: false,
    modelPath: null,
    error: null,
    notice: null,
    pendingConfirmation: null,
  });
}

// Silence the intentional console.error/console.warn the fixes keep for logcat.
beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();
  mockProcess.mockResolvedValue({ type: "text", content: "ok" });
  mockIsLoaded.mockReturnValue(false);
  mockGetModelInfo.mockReturnValue({ loaded: false, path: undefined });
  mockGetInfoAsync.mockResolvedValue({ exists: true } as never);
  resetStore();
});

describe("chat-store — persistence failures surface a notice", () => {
  it("a failed user-message save sets a notice, keeps the message, and is not a hard error", async () => {
    // First saveMessage (the user turn) rejects; the assistant turn then saves fine.
    mockSaveMessage
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);

    await useChatStore.getState().sendMessage("ciao");

    const s = useChatStore.getState();
    expect(s.notice).toBe(persistFailureNotice("it"));
    expect(s.error).toBeNull();
    // The user's text is still on screen even though the DB write failed.
    expect(s.messages.some((m) => m.role === "user" && m.content === "ciao")).toBe(true);
  });

  it("a failed assistant-message save sets a notice and keeps the reply in memory", async () => {
    // User turn saves fine; the assistant turn's save rejects.
    mockSaveMessage
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("disk full"));
    mockProcess.mockResolvedValue({ type: "text", content: "risposta" });

    await useChatStore.getState().sendMessage("domanda");

    const s = useChatStore.getState();
    expect(s.notice).toBe(persistFailureNotice("it"));
    expect(s.messages.some((m) => m.role === "assistant" && m.content === "risposta")).toBe(true);
  });

  it("a failed tool-result persist sets a notice and keeps the in-memory result", async () => {
    // Seed a pending confirmation and its message, then decline it (the declined
    // path skips executeToolCall but still persists the tool result).
    useChatStore.setState({
      messages: [
        {
          id: "msg-1",
          conversationId: "conv-1",
          role: "assistant",
          content: "Chiamo Marco?",
          createdAt: 1,
        },
      ],
      pendingConfirmation: { messageId: "msg-1", tool: "make_call", parameters: {} },
    });
    mockUpdateToolResult.mockRejectedValueOnce(new Error("locked"));

    await useChatStore.getState().resolveConfirmation(false);

    const s = useChatStore.getState();
    expect(s.notice).toBe(persistFailureNotice("it"));
    // The declined result is applied in memory regardless of the DB failure.
    const msg = s.messages.find((m) => m.id === "msg-1");
    expect(msg?.toolResult).toContain("declined");
  });

  it("localizes the persistence notice in English", async () => {
    useChatStore.setState({ language: "en" });
    mockSaveMessage.mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);

    await useChatStore.getState().sendMessage("hi");

    expect(useChatStore.getState().notice).toBe(persistFailureNotice("en"));
  });

  it("dismissNotice clears it", () => {
    useChatStore.setState({ notice: "something" });
    useChatStore.getState().dismissNotice();
    expect(useChatStore.getState().notice).toBeNull();
  });
});

describe("chat-store — startup model-load failure", () => {
  it("surfaces a model-load notice (not the misleading 'no model' state) when a selected model fails to load", async () => {
    mockGetLatest.mockResolvedValue(null);
    mockGetActiveModel.mockResolvedValue({
      id: "qwen",
      displayName: "Qwen3 4B",
      filePath: "/models/qwen.gguf",
      contextSize: 4096,
      chatTemplate: null,
    } as never);
    mockIsLoaded.mockReturnValue(false);
    mockGetInfoAsync.mockResolvedValue({ exists: true } as never);
    mockLoadModel.mockRejectedValueOnce(new Error("OOM"));

    await useChatStore.getState().init();

    const s = useChatStore.getState();
    expect(s.notice).toBe(modelLoadFailureNotice("it", "Qwen3 4B"));
    expect(s.notice).toContain("Qwen3 4B");
    expect(s.modelLoaded).toBe(false);
  });

  it("does not set a load notice when there is genuinely no model", async () => {
    mockGetLatest.mockResolvedValue(null);
    mockGetActiveModel.mockResolvedValue(null);

    await useChatStore.getState().init();

    expect(useChatStore.getState().notice).toBeNull();
  });
});

describe("notices — pure localized strings", () => {
  it("persistFailureNotice differs by language and is non-empty", () => {
    expect(persistFailureNotice("it")).toMatch(/riavvio/i);
    expect(persistFailureNotice("en")).toMatch(/restart/i);
    expect(persistFailureNotice("it")).not.toBe(persistFailureNotice("en"));
  });

  it("modelLoadFailureNotice embeds the model name in both languages", () => {
    expect(modelLoadFailureNotice("it", "Qwen3 4B")).toContain("Qwen3 4B");
    expect(modelLoadFailureNotice("en", "Qwen3 4B")).toContain("Qwen3 4B");
    expect(modelLoadFailureNotice("it", "X")).not.toBe(modelLoadFailureNotice("en", "X"));
  });
});
