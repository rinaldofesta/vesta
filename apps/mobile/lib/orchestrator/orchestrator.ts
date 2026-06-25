// Orchestrator — the core brain of Vesta.
// Routes user messages through the LLM, parses tool calls, dispatches actions.
// Now includes memory retrieval (inject into prompt) and extraction (post-response).

import { generate, isLoaded } from "../llm/llm-engine";
import type { CompletionMessage } from "../llm/llm-engine";
import { buildSystemPrompt } from "./prompt-builder";
import { parseResponse, stripThinkTags, looksLikeToolAttempt } from "./response-parser";
import type {
  Language,
  OrchestratorResponse,
  Message,
} from "./types";
import { dispatchToolCall } from "./tool-dispatcher";
import {
  getMemoriesForPrompt,
  extractMemories,
  shouldExtractMemory,
  cancelExtraction,
} from "./memory-manager";
import { getKnowledgeForPrompt } from "./knowledge-manager";
import { getConfig } from "../storage/database";
import { toolRequiresConfirmation } from "../tools/tool-registry";
import type { ToolCallResult } from "./types";

const MAX_HISTORY_MESSAGES = 20;

// Runs a confirmed tool call. Called by the store after the user approves a
// pending (destructive) action; routing already validated the tool name.
export function executeToolCall(
  tool: string,
  parameters: Record<string, unknown>,
): Promise<ToolCallResult> {
  return dispatchToolCall(tool, parameters);
}

export async function processMessage(
  userText: string,
  history: Message[],
  lang: Language,
  onToken?: (token: string) => void,
): Promise<OrchestratorResponse> {
  if (!isLoaded()) {
    return { type: "error", error: "No model loaded" };
  }

  // Fetch relevant memories and knowledge files for context injection, plus the
  // destructive-action confirmation setting (default ON for safety).
  let memoriesBlock: string | null = null;
  let knowledgeBlock: string | null = null;
  let confirmEnabled = true;
  try {
    const [m, k, confirmCfg] = await Promise.all([
      getMemoriesForPrompt(),
      getKnowledgeForPrompt(),
      getConfig("confirm_destructive_actions"),
    ]);
    memoriesBlock = m;
    knowledgeBlock = k;
    confirmEnabled = confirmCfg !== "false";
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
    // A background memory-extraction pass may still hold the engine lock.
    // Cancel it (it stops the native completion) so this user turn starts
    // immediately instead of waiting for the extraction to finish (ORCH-1).
    cancelExtraction();

    // Lower temperature than the engine default: this turn must emit clean
    // tool-call JSON, and near-deterministic sampling improves validity and
    // tool-selection consistency without hurting chat quality much (LLM-5).
    const result = await generate(
      messages,
      { maxTokens: 4096, temperature: 0.3 },
      onToken,
    );
    const raw = result.text;

    // Try to parse as tool call
    const toolCall = parseResponse(raw);

    let response: OrchestratorResponse;

    if (toolCall) {
      const confirmMessage =
        toolCall.message || (lang === "it" ? "Fatto!" : "Done!");
      if (toolRequiresConfirmation(toolCall.tool, confirmEnabled)) {
        // Don't touch the device yet — hand the proposed action to the UI for
        // explicit user confirmation. The store dispatches it via executeToolCall.
        response = {
          type: "pending_tool_call",
          tool: toolCall.tool,
          parameters: toolCall.parameters,
          message: confirmMessage,
        };
      } else {
        const toolResult = await dispatchToolCall(
          toolCall.tool,
          toolCall.parameters,
        );
        response = {
          type: "tool_call",
          tool: toolCall.tool,
          parameters: toolCall.parameters,
          message: confirmMessage,
          result: toolResult,
        };
      }
    } else if (looksLikeToolAttempt(raw)) {
      // The model tried to emit a tool call but it didn't parse — almost always
      // truncated by the token limit. Show a clean retry hint instead of dumping
      // raw partial JSON like `{"tool":"set_alarm","parameters":{...` (ORCH-8).
      response = {
        type: "text",
        content:
          lang === "it"
            ? "Non sono riuscito a completare quell'azione (risposta troncata). Riprova, magari riformulando."
            : "I couldn't complete that action (the response was cut off). Please try again, perhaps rephrasing.",
      };
    } else {
      // Plain text response — keep think tags for styled UI rendering
      response = { type: "text", content: raw };
    }

    // Fire-and-forget: extract memories from this exchange — but skip turns that
    // can't yield a useful fact (tool-call confirmations, greetings/acks). This
    // avoids a second full LLM pass that, because the engine serializes all
    // generation, would otherwise stall the user's next message (ORCH-1).
    const isToolTurn =
      response.type === "tool_call" || response.type === "pending_tool_call";
    if (shouldExtractMemory(userText, isToolTurn)) {
      const assistantContent =
        response.type === "text" ? stripThinkTags(response.content) : response.message;
      extractMemories(userText, assistantContent, "", lang).catch((err) => {
        console.warn("[Orchestrator] Memory extraction failed:", err);
      });
    }

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { type: "error", error: message };
  }
}
