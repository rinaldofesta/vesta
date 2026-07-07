// Orchestrator — the core brain of Vesta.
// Routes user messages through the LLM, parses tool calls, dispatches actions.
// Now includes memory retrieval (inject into prompt) and extraction (post-response).

import { generate, isLoaded } from "../llm/llm-engine";
import type { CompletionMessage } from "../llm/llm-engine";
import { buildStablePrefix, annotateUserMessage } from "./prompt-builder";
import { schedulePrefixPersist } from "./session-warmer";
import { parseResponse, stripThinkTags, looksLikeToolAttempt } from "./response-parser";
import type {
  Language,
  OrchestratorResponse,
  Message,
  ToolCallResult,
  ParsedToolCall,
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
import { toolRequiresConfirmation, toolReturnsData } from "../tools/tool-registry";

const MAX_HISTORY_MESSAGES = 20;
// Once the conversation exceeds the window, `slice(-MAX)` would re-slice to a
// different set every turn — the replayed history's head would shift by one
// each turn and re-prefill the whole window (the V4 append win evaporates on
// long chats). Instead we pin the window START to a multiple of this stride, so
// it only advances in jumps: between jumps the head is byte-identical and the
// turn stays a pure KV append; only a boundary crossing pays one re-prefill
// (~once per stride messages instead of every turn). Cost: the window can hold
// up to MAX + STRIDE - 1 messages — still far under the context size.
const HISTORY_SLIDE_STRIDE = 8;

// The index of the first history message to include. Rounds the "last MAX"
// start DOWN to a stride boundary so it advances every STRIDE messages, not
// every turn. Exported for the byte-stability tests. Pure function of length.
export function historyWindowStart(total: number): number {
  const minStart = Math.max(0, total - MAX_HISTORY_MESSAGES);
  return Math.floor(minStart / HISTORY_SLIDE_STRIDE) * HISTORY_SLIDE_STRIDE;
}

// Runs a confirmed tool call. Called by the store after the user approves a
// pending (destructive) action; routing already validated the tool name.
export function executeToolCall(
  tool: string,
  parameters: Record<string, unknown>,
  lang: Language = "en",
): Promise<ToolCallResult> {
  return dispatchToolCall(tool, parameters, lang);
}

export async function processMessage(
  userText: string,
  history: Message[],
  lang: Language,
  onToken?: (token: string) => void,
  // Read/query tools generate twice (detect the tool, then answer from its
  // data). This clears the streamed tool-call JSON before the answer streams,
  // so the user sees a clean reply instead of "JSON…answer".
  onStreamReset?: () => void,
  // The instant this turn's time context renders from. Callers that persist
  // the message pass its createdAt so the live render and every future
  // history replay come from the SAME instant — byte-identical by
  // construction, which is the KV-cache invariant. Defaults to now.
  sentAt: Date = new Date(),
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

  // The system prompt is fully STATIC (V4): the date lives in a per-turn
  // [Contesto temporale: ...] line on each user message instead of a volatile
  // tail. History turns render from their stored createdAt — a pure function,
  // so the replayed history is byte-identical across turns and the whole
  // conversation stays a growing KV-cache prefix.
  const stablePrefix = buildStablePrefix(lang, memoriesBlock, knowledgeBlock);

  // Build conversation messages for the LLM
  const messages: CompletionMessage[] = [
    { role: "system", content: stablePrefix },
  ];

  // Add recent history (anchored sliding window — see historyWindowStart).
  const recent = history.slice(historyWindowStart(history.length));
  for (const msg of recent) {
    if (msg.role === "user") {
      messages.push({
        role: "user",
        content: annotateUserMessage(lang, new Date(msg.createdAt), msg.content),
      });
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

  // Add current user message with this turn's time context.
  messages.push({
    role: "user",
    content: annotateUserMessage(lang, sentAt, userText),
  });

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
    if (__DEV__) {
      console.log(
        `[Perf] promptMs=${Math.round(result.timings.promptMs)} predictedPerSecond=${result.timings.predictedPerSecond.toFixed(1)}`,
      );
    }

    // True when this turn ran more than the single first-pass generate (query
    // loop or malformed-JSON retry). Those paths append extra messages to the
    // KV state, so the session-cache persist guard's token estimate (built
    // from `messages` alone) would undercount — skip persisting those turns.
    let extraGenerationRan = false;

    // Handles a successfully-parsed tool call. Extracted so both the first-pass
    // parse and the malformed-JSON retry below reuse the same dispatch logic:
    // read/query tools run inline (the query loop), destructive tools are gated
    // for confirmation, everything else dispatches directly.
    const handleToolCall = async (
      call: ParsedToolCall,
      callRaw: string,
    ): Promise<Exclude<OrchestratorResponse, { type: "error" }>> => {
      if (toolReturnsData(call.tool)) {
        // Read/query tool: run it, then re-generate an answer grounded in the
        // returned data (a function-calling loop). Never gated — read-only.
        const toolResult = await dispatchToolCall(
          call.tool,
          call.parameters,
          lang,
        );
        if (!toolResult.success) {
          // e.g. permission denied or no data — surface the reason as text.
          return { type: "text", content: toolResult.message };
        }
        // Clear the streamed tool-call JSON, then stream the real answer.
        onStreamReset?.();
        extraGenerationRan = true;
        // Annotated like every user message: the RULES point date resolution
        // at the MOST RECENT user message's time context, and this synthetic
        // turn is now it. Never persisted, so no replay-stability concern.
        const followupMessages: CompletionMessage[] = [
          ...messages,
          { role: "assistant", content: callRaw },
          {
            role: "user",
            content: annotateUserMessage(
              lang,
              sentAt,
              lang === "it"
                ? `Risultato dello strumento ${call.tool}:\n${toolResult.data ?? "(nessun dato)"}\n\nRispondi alla mia richiesta precedente in italiano, in modo naturale e conciso, usando SOLO questi dati. Non mostrare JSON.`
                : `Result of tool ${call.tool}:\n${toolResult.data ?? "(no data)"}\n\nAnswer my previous request in English, naturally and concisely, using ONLY this data. Do not show JSON.`,
            ),
          },
        ];
        const followup = await generate(
          followupMessages,
          { maxTokens: 1024, temperature: 0.4 },
          onToken,
        );
        // Guard: if the model answered with a tool-call JSON instead of prose
        // (it shouldn't, but the system prompt still allows JSON), don't dump
        // raw JSON at the user — fall back to a plain message.
        const answer =
          parseResponse(followup.text) || looksLikeToolAttempt(followup.text)
            ? lang === "it"
              ? "Ho recuperato i dati ma non sono riuscito a formulare una risposta. Riprova."
              : "I fetched the data but couldn't phrase an answer. Please try again."
            : followup.text;
        return { type: "text", content: answer };
      }

      const confirmMessage = call.message || (lang === "it" ? "Fatto!" : "Done!");
      if (toolRequiresConfirmation(call.tool, confirmEnabled)) {
        // Don't touch the device yet — hand the proposed action to the UI for
        // explicit user confirmation. The store dispatches it via executeToolCall.
        return {
          type: "pending_tool_call",
          tool: call.tool,
          parameters: call.parameters,
          message: confirmMessage,
        };
      }
      const toolResult = await dispatchToolCall(call.tool, call.parameters, lang);
      return {
        type: "tool_call",
        tool: call.tool,
        parameters: call.parameters,
        message: confirmMessage,
        result: toolResult,
      };
    };

    // Try to parse as tool call
    const toolCall = parseResponse(raw);

    let response: OrchestratorResponse;

    if (toolCall) {
      response = await handleToolCall(toolCall, raw);
    } else if (looksLikeToolAttempt(raw)) {
      // The model tried to emit a tool call but it didn't parse — malformed or
      // truncated. Per the Fase 2 exit gate, retry ONCE with a correction prompt
      // demanding valid JSON only; if it still fails, degrade gracefully instead
      // of dumping raw partial JSON at the user (ORCH-8).
      const truncatedHint =
        lang === "it"
          ? "Non sono riuscito a completare quell'azione (risposta troncata). Riprova, magari riformulando."
          : "I couldn't complete that action (the response was cut off). Please try again, perhaps rephrasing.";

      if (result.stoppedByUser) {
        // The user tapped Stop mid-stream — don't launch a fresh generation they
        // just asked to cancel; show the hint (matches the pre-retry behavior).
        response = { type: "text", content: truncatedHint };
      } else {
        onStreamReset?.();
        extraGenerationRan = true;
        const correction: CompletionMessage[] = [
          ...messages,
          // Cap the (possibly runaway/repetitive) bad output so it can't dominate
          // the retry context or re-seed the same degenerate pattern.
          { role: "assistant", content: raw.slice(0, 800) },
          {
            // Annotated: this retry may re-emit date-bearing tool JSON, and
            // the RULES point at the most recent user message's time context.
            role: "user",
            content: annotateUserMessage(
              lang,
              sentAt,
              lang === "it"
                ? "La tua risposta precedente non era un JSON valido. Rispondi di nuovo con SOLO l'oggetto JSON dello strumento, senza testo, senza spiegazioni e senza blocchi di codice."
                : "Your previous reply was not valid JSON. Reply again with ONLY the tool JSON object — no prose, no explanation, no code fence.",
            ),
          },
        ];
        // Silent correction pass (no onToken): don't stream a second raw-JSON
        // attempt at the user; the first streamed attempt was cleared above. A
        // tool-call JSON is short, so a tight token cap keeps the wait small.
        const retry = await generate(correction, {
          maxTokens: 512,
          temperature: 0.2,
        });
        if (retry.stoppedByUser) {
          response = { type: "text", content: truncatedHint };
        } else {
          const retryToolCall = parseResponse(retry.text);
          if (retryToolCall) {
            response = await handleToolCall(retryToolCall, retry.text);
          } else if (
            stripThinkTags(retry.text).trim() &&
            !looksLikeToolAttempt(retry.text)
          ) {
            // Retry produced usable prose — fall back to general chat.
            response = { type: "text", content: retry.text };
          } else {
            // Still a broken or empty tool attempt — show the clean hint.
            response = { type: "text", content: truncatedHint };
          }
        }
      }
    } else {
      // Plain text response — keep think tags for styled UI rendering
      response = { type: "text", content: raw };
    }

    // Fire-and-forget: persist the stable prefix's KV state for the next cold
    // launch, if the on-disk cache is stale. Only after a clean single-generate
    // turn: a user Stop can interrupt prefill mid-prefix, and multi-generate
    // paths break the guard's token estimate (see extraGenerationRan). Must be
    // called BEFORE extractMemories: the persist path is synchronous up to its
    // engine-lock enqueue, so the snapshot enters the FIFO lock queue ahead of
    // the extraction generate and captures the just-finished turn's KV state.
    if (!result.stoppedByUser && !extraGenerationRan) {
      schedulePrefixPersist(stablePrefix, lang, messages, result.tokensPredicted);
    }

    // Fire-and-forget: extract memories from this exchange — but skip turns that
    // can't yield a useful fact (tool-call confirmations, greetings/acks). This
    // avoids a second full LLM pass that, because the engine serializes all
    // generation, would otherwise stall the user's next message (ORCH-1).
    // Pass this turn's message list: extraction appends its request to the chat
    // context so it reuses (and preserves) the cached prompt prefix instead of
    // evicting it with a standalone prompt — see extractMemories (REV-1).
    const isToolTurn =
      response.type === "tool_call" || response.type === "pending_tool_call";
    if (shouldExtractMemory(userText, isToolTurn)) {
      const assistantContent =
        response.type === "text" ? stripThinkTags(response.content) : response.message;
      extractMemories(messages, assistantContent, "", lang).catch((err) => {
        console.warn("[Orchestrator] Memory extraction failed:", err);
      });
    }

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { type: "error", error: message };
  }
}
