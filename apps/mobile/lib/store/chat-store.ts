// Zustand store for chat state management.
// Drives the chat UI and coordinates between orchestrator, storage, and LLM.

import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { Message, Language, OrchestratorResponse } from "../orchestrator/types";
import { processMessage } from "../orchestrator/orchestrator";
import { saveMessage, getMessages, getConfig, setConfig } from "../storage/database";
import { isLoaded, getModelInfo } from "../llm/llm-engine";

interface ChatState {
  messages: Message[];
  conversationId: string;
  language: Language;
  isGenerating: boolean;
  streamingText: string;
  modelLoaded: boolean;
  modelPath: string | null;
  error: string | null;

  // Actions
  init: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  clearConversation: () => void;
  setLanguage: (lang: Language) => Promise<void>;
  updateModelStatus: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  conversationId: uuid(),
  language: "it",
  isGenerating: false,
  streamingText: "",
  modelLoaded: false,
  modelPath: null,
  error: null,

  init: async () => {
    const lang = await getConfig("language");
    if (lang === "it" || lang === "en") set({ language: lang });

    const { conversationId } = get();
    const messages = await getMessages(conversationId);
    const info = getModelInfo();
    set({
      messages,
      modelLoaded: info.loaded,
      modelPath: info.path ?? null,
    });
  },

  sendMessage: async (text: string) => {
    if (get().isGenerating) return; // prevent concurrent sends

    const { conversationId, language } = get();

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
      await saveMessage(userMsg);
    } catch (err) {
      console.error("Failed to persist user message:", err);
    }

    // Read current state (includes userMsg) for orchestrator context
    const currentMessages = get().messages;
    const response: OrchestratorResponse = await processMessage(
      text,
      currentMessages,
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
    } catch (err) {
      console.error("Failed to persist assistant message:", err);
    }
  },

  clearConversation: () => {
    set({
      messages: [],
      conversationId: uuid(),
      streamingText: "",
      error: null,
    });
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
