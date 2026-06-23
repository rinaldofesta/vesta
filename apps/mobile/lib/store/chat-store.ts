// Zustand store for chat state management.
// Drives the chat UI and coordinates between orchestrator, storage, and LLM.
// Persists conversations across app restarts via SQLite.

import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type {
  Message,
  Language,
  OrchestratorResponse,
  ToolCallResult,
} from "../orchestrator/types";
import { processMessage, executeToolCall } from "../orchestrator/orchestrator";
import {
  saveMessage,
  getMessages,
  getConfig,
  setConfig,
  createConversation,
  getLatestConversation,
  updateConversationTitle,
  touchConversation,
  deleteConversation,
  updateMessageToolResult,
} from "../storage/database";
import {
  loadModel,
  isLoaded,
  getModelInfo,
  stopGeneration as llmStopGeneration,
} from "../llm/llm-engine";
import { runMemoryDecay } from "../orchestrator/memory-manager";
import { startVestaService } from "../native/vesta-service";
import * as FileSystem from "expo-file-system/legacy";
import {
  ensureLegacyMigration,
  getActiveModel,
  setModelState,
} from "../models/model-registry";

// A destructive tool call parsed but not yet executed — awaiting the user's
// explicit confirmation. Held in memory only: a restart never auto-executes it.
interface PendingConfirmation {
  messageId: string;
  tool: string;
  parameters: Record<string, unknown>;
}

interface ChatState {
  messages: Message[];
  conversationId: string;
  conversationTitle: string | null;
  language: Language;
  isGenerating: boolean;
  streamingText: string;
  modelLoaded: boolean;
  modelPath: string | null;
  error: string | null;
  pendingConfirmation: PendingConfirmation | null;

  // Actions
  init: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  stopGenerating: () => void;
  resolveConfirmation: (confirmed: boolean) => Promise<void>;
  loadConversation: (id: string, title: string | null) => Promise<void>;
  clearConversation: () => void;
  deleteAndSwitch: (id: string) => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
  updateModelStatus: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  conversationId: uuid(),
  conversationTitle: null,
  language: "it",
  isGenerating: false,
  streamingText: "",
  modelLoaded: false,
  modelPath: null,
  error: null,
  pendingConfirmation: null,

  init: async () => {
    const lang = await getConfig("language");
    if (lang === "it" || lang === "en") set({ language: lang });

    // Try to restore the latest conversation
    const latest = await getLatestConversation();
    let conversationId: string;

    if (latest) {
      conversationId = latest.id;
      const messages = await getMessages(conversationId);
      set({
        conversationId,
        conversationTitle: latest.title,
        messages,
      });
    } else {
      // First launch — lazy: just set ID, don't persist until first message
      conversationId = uuid();
      set({ conversationId, messages: [] });
    }

    // Start foreground service to keep process alive
    startVestaService().catch(() => {});

    // Auto-load the active model from the registry (migrating any legacy
    // model_path on first run). Don't erase the selection on a transient load
    // failure — only mark it errored when the file is genuinely gone, so a
    // low-memory boot doesn't force re-downloading a multi-GB model.
    try {
      await ensureLegacyMigration();
      const active = await getActiveModel();
      if (active && !isLoaded()) {
        const fileInfo = await FileSystem.getInfoAsync(active.filePath);
        if (fileInfo.exists) {
          await loadModel(active.filePath, {
            contextSize: active.contextSize,
            gpuLayers: 0,
            chatTemplate: active.chatTemplate ?? undefined,
          });
        } else {
          await setModelState(active.id, "error");
        }
      }
    } catch (err) {
      console.warn("[chat-store] model auto-load failed:", err);
    }

    const info = getModelInfo();
    set({
      modelLoaded: info.loaded,
      modelPath: info.path ?? null,
    });

    // Run memory decay on startup (lightweight)
    runMemoryDecay().catch(() => {});
  },

  sendMessage: async (text: string) => {
    if (get().isGenerating) return; // prevent concurrent sends

    // Moving on with a new message implicitly declines any unconfirmed action.
    if (get().pendingConfirmation) {
      await get().resolveConfirmation(false);
    }

    const { conversationId, language, messages: currentMsgs } = get();

    // Create user message
    const userMsg: Message = {
      id: uuid(),
      conversationId,
      role: "user",
      content: text,
      createdAt: Date.now(),
    };

    // Use updater to avoid stale closure
    set((s) => ({
      messages: [...s.messages, userMsg],
      isGenerating: true,
      streamingText: "",
      error: null,
    }));

    try {
      // Lazy creation: ensure conversation exists in DB before first message
      if (currentMsgs.length === 0) {
        await createConversation(conversationId);
      }
      await saveMessage(userMsg);
      await touchConversation(conversationId);
    } catch (err) {
      console.error("Failed to persist user message:", err);
    }

    // Auto-title: use first user message as conversation title
    if (currentMsgs.length === 0) {
      const title = text.length > 50 ? text.substring(0, 47) + "..." : text;
      set({ conversationTitle: title });
      updateConversationTitle(conversationId, title).catch(() => {});
    }

    // Read current state (includes userMsg) for orchestrator context
    const allMessages = get().messages;
    const response: OrchestratorResponse = await processMessage(
      text,
      allMessages,
      language,
      (token) => {
        set((s) => ({ streamingText: s.streamingText + token }));
      },
    );

    // Create assistant message based on response type
    let assistantMsg: Message;

    switch (response.type) {
      case "tool_call":
        assistantMsg = {
          id: uuid(),
          conversationId,
          role: "assistant",
          content: response.message,
          toolCall: JSON.stringify({
            tool: response.tool,
            parameters: response.parameters,
          }),
          toolResult: JSON.stringify(response.result),
          createdAt: Date.now(),
        };
        break;

      case "pending_tool_call": {
        // Destructive action proposed — show it with Confirm/Cancel and DO NOT
        // execute until the user approves (toolResult left undefined = pending).
        const pendingMsg: Message = {
          id: uuid(),
          conversationId,
          role: "assistant",
          content: response.message,
          toolCall: JSON.stringify({
            tool: response.tool,
            parameters: response.parameters,
          }),
          createdAt: Date.now(),
        };
        set((s) => ({
          messages: [...s.messages, pendingMsg],
          isGenerating: false,
          streamingText: "",
          pendingConfirmation: {
            messageId: pendingMsg.id,
            tool: response.tool,
            parameters: response.parameters,
          },
        }));
        try {
          await saveMessage(pendingMsg);
          await touchConversation(conversationId);
        } catch (err) {
          console.error("Failed to persist pending message:", err);
        }
        return;
      }

      case "text":
        assistantMsg = {
          id: uuid(),
          conversationId,
          role: "assistant",
          content: response.content,
          createdAt: Date.now(),
        };
        break;

      case "error":
        set({ isGenerating: false, streamingText: "", error: response.error });
        return;
    }

    set((s) => ({
      messages: [...s.messages, assistantMsg],
      isGenerating: false,
      streamingText: "",
    }));

    try {
      await saveMessage(assistantMsg);
      await touchConversation(conversationId);
    } catch (err) {
      console.error("Failed to persist assistant message:", err);
    }
  },

  stopGenerating: () => {
    // Signals the native layer to stop the active completion. The in-flight
    // generate() then resolves with the partial text and sendMessage finishes
    // normally (appending what was produced and flipping isGenerating off).
    llmStopGeneration().catch(() => {});
  },

  resolveConfirmation: async (confirmed: boolean) => {
    const pending = get().pendingConfirmation;
    if (!pending) return;

    // Clear first so a second tap / concurrent send can't double-dispatch.
    set({ pendingConfirmation: null });

    let result: ToolCallResult;
    if (confirmed) {
      try {
        result = await executeToolCall(pending.tool, pending.parameters);
      } catch (err) {
        result = {
          success: false,
          message: "Action failed",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } else {
      result = {
        success: false,
        message: get().language === "it" ? "Annullato" : "Canceled",
        error: "declined",
      };
    }

    const toolResultStr = JSON.stringify(result);
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === pending.messageId ? { ...m, toolResult: toolResultStr } : m,
      ),
    }));
    try {
      await updateMessageToolResult(pending.messageId, toolResultStr);
    } catch (err) {
      console.error("Failed to persist tool result:", err);
    }
  },

  loadConversation: async (id: string, title: string | null) => {
    const messages = await getMessages(id);
    set({
      conversationId: id,
      conversationTitle: title,
      messages,
      streamingText: "",
      error: null,
      pendingConfirmation: null,
    });
  },

  clearConversation: () => {
    // Lazy creation: don't persist to DB until first message is sent
    set({
      messages: [],
      conversationId: uuid(),
      conversationTitle: null,
      streamingText: "",
      error: null,
      pendingConfirmation: null,
    });
  },

  deleteAndSwitch: async (id: string) => {
    await deleteConversation(id);

    // If we deleted the active conversation, switch to the next one
    if (get().conversationId === id) {
      const latest = await getLatestConversation();
      if (latest) {
        const messages = await getMessages(latest.id);
        set({
          conversationId: latest.id,
          conversationTitle: latest.title,
          messages,
          streamingText: "",
          error: null,
          pendingConfirmation: null,
        });
      } else {
        // No conversations left — start fresh (lazy, not persisted)
        set({
          messages: [],
          conversationId: uuid(),
          conversationTitle: null,
          streamingText: "",
          error: null,
          pendingConfirmation: null,
        });
      }
    }
  },

  setLanguage: async (lang: Language) => {
    set({ language: lang });
    await setConfig("language", lang);
  },

  updateModelStatus: () => {
    const info = getModelInfo();
    set({ modelLoaded: info.loaded, modelPath: info.path ?? null });
  },
}));
