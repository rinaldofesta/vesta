// Zustand store for chat state management.
// Drives the chat UI and coordinates between orchestrator, storage, and LLM.
// Persists conversations across app restarts via SQLite.

import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { Message, Language, OrchestratorResponse } from "../orchestrator/types";
import { processMessage } from "../orchestrator/orchestrator";
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
} from "../storage/database";
import { isLoaded, getModelInfo } from "../llm/llm-engine";
import { runMemoryDecay } from "../orchestrator/memory-manager";

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

  // Actions
  init: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
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

  loadConversation: async (id: string, title: string | null) => {
    const messages = await getMessages(id);
    set({
      conversationId: id,
      conversationTitle: title,
      messages,
      streamingText: "",
      error: null,
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
        });
      } else {
        // No conversations left — start fresh (lazy, not persisted)
        set({
          messages: [],
          conversationId: uuid(),
          conversationTitle: null,
          streamingText: "",
          error: null,
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
