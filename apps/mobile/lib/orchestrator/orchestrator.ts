// Orchestrator — the core brain of Vesta.
// Routes user messages through the LLM, parses tool calls, dispatches actions.
// Now includes memory retrieval (inject into prompt) and extraction (post-response).

import { generate, isLoaded } from "../llm/llm-engine";
import type { CompletionMessage } from "../llm/llm-engine";
import { buildSystemPrompt } from "./prompt-builder";
import { parseResponse, stripThinkTags } from "./response-parser";
import type {
  Language,
  OrchestratorResponse,
  Message,
} from "./types";
import { dispatchToolCall } from "./tool-dispatcher";
import { getMemoriesForPrompt, extractMemories } from "./memory-manager";
import { getKnowledgeForPrompt } from "./knowledge-manager";

const MAX_HISTORY_MESSAGES = 20;

export async function processMessage(
  userText: string,
  history: Message[],
  lang: Language,
  onToken?: (token: string) => void,
): Promise<OrchestratorResponse> {
  if (!isLoaded()) {
    return { type: "error", error: "No model loaded" };
  }

  // Fetch relevant memories and knowledge files for context injection
  let memoriesBlock: string | null = null;
  let knowledgeBlock: string | null = null;
  try {
    [memoriesBlock, knowledgeBlock] = await Promise.all([
      getMemoriesForPrompt(),
      getKnowledgeForPrompt(),
    ]);
  } catch (err) {
    console.warn("[Orchestrator] Failed to fetch context:", err);
  }

  const systemPrompt = buildSystemPrompt(lang, memoriesBlock, knowledgeBlock);

  // Build conversation messages for the LLM
  const messages: CompletionMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  // Add recent history (trimmed to avoid blowing context)
  const recent = history.slice(-MAX_HISTORY_MESSAGES);
  for (const msg of recent) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      let content = msg.content;
      // Append tool result so the LLM can see what happened in follow-up turns
      if (msg.toolCall && msg.toolResult) {
        try {
          const call = JSON.parse(msg.toolCall);
          const result = JSON.parse(msg.toolResult);
          const status = result.success ? "success" : "failed";
          content += `\n[Tool: ${call.tool} → ${status}${result.error ? ": " + result.error : ""}]`;
        } catch {
          // corrupted JSON — skip annotation
        }
      }
      messages.push({ role: "assistant", content });
    }
  }

  // Add current user message
  messages.push({ role: "user", content: userText });

  try {
    const result = await generate(messages, { maxTokens: 4096 }, onToken);
    const raw = result.text;

    // Try to parse as tool call
    const toolCall = parseResponse(raw);

    let response: OrchestratorResponse;

    if (toolCall) {
      const toolResult = await dispatchToolCall(
        toolCall.tool,
        toolCall.parameters,
      );
      response = {
        type: "tool_call",
        tool: toolCall.tool,
        parameters: toolCall.parameters,
        message:
          toolCall.message ||
          (lang === "it" ? "Fatto!" : "Done!"),
        result: toolResult,
      };
    } else {
      // Plain text response — keep think tags for styled UI rendering
      response = { type: "text", content: raw };
    }

    // Fire-and-forget: extract memories from this exchange
    const assistantContent =
      response.type === "text" ? stripThinkTags(response.content) : response.message;
    extractMemories(userText, assistantContent, "", lang).catch(() => {});

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { type: "error", error: message };
  }
}
