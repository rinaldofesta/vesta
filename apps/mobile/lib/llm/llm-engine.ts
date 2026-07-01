// LLM Engine — TypeScript adapter wrapping llama.rn into Vesta's interface.
// Handles model lifecycle (load/unload) and completion with streaming support.

import {
  initLlama,
  loadLlamaModelInfo,
  LlamaContext,
  type RNLlamaOAICompatibleMessage,
  type NativeCompletionResult,
  type TokenData,
} from "llama.rn";
import type { LlmOptions, GenerateOptions, ModelInfo } from "./types";

export interface CompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionResult {
  text: string;
  reasoningContent: string;
  tokensPredicted: number;
  tokensEvaluated: number;
  timings: {
    promptMs: number;
    predictedMs: number;
    predictedPerSecond: number;
  };
  stoppedByLimit: boolean;
  // True when this completion ended because the user tapped Stop (vs. a natural
  // finish or token-limit). Lets callers avoid follow-up work after a stop.
  stoppedByUser: boolean;
}

const DEFAULT_OPTIONS: Required<
  Pick<LlmOptions, "contextSize" | "gpuLayers" | "threads" | "useMlock">
> = {
  contextSize: 4096,
  gpuLayers: 0,
  threads: 4,
  useMlock: false,
};

const DEFAULT_GENERATE: Required<
  Pick<
    GenerateOptions,
    | "maxTokens"
    | "temperature"
    | "topP"
    | "stopSequences"
    | "penaltyRepeat"
    | "penaltyLastN"
  >
> = {
  maxTokens: 4096,
  temperature: 0.7,
  topP: 0.95,
  stopSequences: [],
  // Anti-loop defaults. 1.1 is the conventional llama.cpp repeat penalty; the
  // engine default is 1.0 (off), which lets greedy/low-temp decoding degenerate
  // into endless repetition on long chat answers.
  penaltyRepeat: 1.1,
  penaltyLastN: 256,
};

// --- Async mutex: serializes load/unload/generate to prevent races ---
let operationLock: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  const prev = operationLock;
  operationLock = next;
  return prev.then(fn).finally(() => release!());
}

let context: LlamaContext | null = null;
let currentModelPath: string | null = null;
let currentContextSize: number = DEFAULT_OPTIONS.contextSize;
// Set by stopGeneration(), read+cleared by the active generate(). Distinguishes a
// user-initiated Stop from a natural finish (the native layer exposes no such flag).
let stopRequested = false;
// True once any completion has touched the KV cache since the last model load
// (or explicit clear). Restoring a session file over live conversation state
// would discard it and force a full history re-prefill on the next turn, so
// loadSessionFile only runs while this is false.
let kvStateDirty = false;

// Rough token estimate (~3 chars/token is conservative for Italian/English
// BPE) plus per-message chat-template overhead. Used to decide whether
// context-window-sensitive background work (memory extraction, session-cache
// save) is safe to run — precision doesn't matter.
const TEMPLATE_TOKENS_PER_MESSAGE = 8;

export function estimatePromptTokens(messages: CompletionMessage[]): number {
  return messages.reduce(
    (n, m) => n + Math.ceil(m.content.length / 3) + TEMPLATE_TOKENS_PER_MESSAGE,
    0,
  );
}

export function getModelInfo(): ModelInfo {
  return {
    loaded: context !== null,
    path: currentModelPath ?? undefined,
  };
}

export function isLoaded(): boolean {
  return context !== null;
}

// Context window (n_ctx) of the loaded model. Callers sizing optional
// background work (e.g. memory extraction) use this to avoid pushing past
// n_ctx, where ctx_shift would evict the cached prompt prefix.
export function getContextSize(): number {
  return currentContextSize;
}

export function loadModel(
  modelPath: string,
  options?: LlmOptions,
  onProgress?: (progress: number) => void,
): Promise<void> {
  return withLock(async () => {
    if (context && currentModelPath === modelPath) return; // already loaded

    // Release previous model if any
    if (context) {
      await context.release();
      context = null;
      currentModelPath = null;
    }

    const opts = { ...DEFAULT_OPTIONS, ...options };
    currentContextSize = opts.contextSize;
    context = await initLlama(
      {
        model: modelPath,
        n_ctx: opts.contextSize,
        n_gpu_layers: opts.gpuLayers,
        n_threads: opts.threads,
        use_mlock: opts.useMlock,
        // Roll the oldest tokens out of the KV cache instead of hard-failing
        // when a long chat exceeds n_ctx (LLM-6).
        ctx_shift: true,
        // Quantize the KV cache when requested (halves KV RAM). V-cache quant
        // needs flash attention, so enable it alongside.
        ...(options?.kvCacheType
          ? {
              cache_type_k: options.kvCacheType,
              cache_type_v: options.kvCacheType,
              flash_attn_type: "on" as const,
            }
          : {}),
        // Only override the embedded template when one is explicitly provided.
        ...(options?.chatTemplate ? { chat_template: options.chatTemplate } : {}),
      },
      onProgress,
    );
    currentModelPath = modelPath;
    kvStateDirty = false;
  });
}

// Cheap pre-load validation: reads GGUF header/metadata without a full context
// init. Returns ok:false for renamed/truncated/non-GGUF files so callers can
// reject before committing disk + load time.
export async function validateGguf(
  modelPath: string,
): Promise<{ ok: boolean; info?: Record<string, unknown>; error?: string }> {
  try {
    const info = (await loadLlamaModelInfo(modelPath)) as Record<string, unknown>;
    if (!info || Object.keys(info).length === 0) {
      return { ok: false, error: "Not a valid GGUF file." };
    }
    return { ok: true, info };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export function unloadModel(): Promise<void> {
  return withLock(async () => {
    if (context) {
      await context.release();
      context = null;
      currentModelPath = null;
    }
  });
}

export function generate(
  messages: CompletionMessage[],
  options?: GenerateOptions,
  onToken?: (token: string) => void,
): Promise<CompletionResult> {
  return withLock(async () => {
    if (!context) throw new Error("No model loaded");

    const opts = { ...DEFAULT_GENERATE, ...options };
    // Fresh turn: clear any stale stop request so it can't leak across turns.
    stopRequested = false;
    kvStateDirty = true;

    const llamaMessages: RNLlamaOAICompatibleMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const result: NativeCompletionResult = await context.completion(
      {
        messages: llamaMessages,
        n_predict: opts.maxTokens,
        temperature: opts.temperature,
        top_p: opts.topP,
        penalty_repeat: opts.penaltyRepeat,
        penalty_last_n: opts.penaltyLastN,
        stop: opts.stopSequences.length > 0 ? opts.stopSequences : undefined,
        // Pass through only when explicitly set, so the model's default stands otherwise.
        ...(options?.enableThinking === false ? { enable_thinking: false } : {}),
      },
      onToken
        ? (data: TokenData) => {
            if (data.token) onToken(data.token);
          }
        : undefined,
    );

    // Use raw `text` so <think> blocks are preserved for UI rendering.
    // The orchestrator / response-parser strips them when needed for tool parsing.
    const text = result.text;

    return {
      text,
      reasoningContent: result.reasoning_content ?? "",
      tokensPredicted: result.tokens_predicted,
      tokensEvaluated: result.tokens_evaluated,
      timings: {
        promptMs: result.timings.prompt_ms,
        predictedMs: result.timings.predicted_ms,
        predictedPerSecond: result.timings.predicted_per_second,
      },
      stoppedByLimit: result.stopped_limit > 0,
      stoppedByUser: stopRequested,
    };
  });
}

// --- KV-session helpers (Fase 4: cold-start prefix cache + dev prefill benchmark) ---

/**
 * Clear the KV cache (and reset the dirty flag). Used by the dev prefill
 * benchmark to guarantee each arm starts from a cold cache.
 */
export function clearKvCache(): Promise<void> {
  return withLock(async () => {
    if (!context) return;
    await context.clearCache();
    kvStateDirty = false;
  });
}

/**
 * Restore a saved KV session. Returns the restored token count plus the
 * DETOKENIZED text of the restored tokens (the caller validates it actually
 * starts with the expected stable prefix — a session file whose content
 * doesn't match would be silently useless forever, since the cache key hashes
 * the prefix text, not the file). Returns null when skipped: no model, or a
 * completion already ran since load (restoring would clobber live state).
 * Callers must treat null/throw as "start cold".
 */
export function loadSessionFile(
  path: string,
): Promise<{ tokensLoaded: number; prompt: string } | null> {
  return withLock(async () => {
    if (!context || kvStateDirty) return null;
    const result = await context.loadSession(path);
    return { tokensLoaded: result.tokens_loaded, prompt: result.prompt };
  });
}

// Longest common prefix of two token arrays. Exported for unit tests.
export function commonPrefixLength(a: number[], b: number[]): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

/**
 * Persist the stable-prefix region of the current KV state to disk.
 *
 * The TOKEN LIST to save is bounded by rendering the system message with two
 * probe tails whose datetimes diverge, tokenizing both, and taking the longest
 * common token prefix — everything before the first time-derived token. A
 * future launch's prompt matches those tokens exactly, so llama.rn resumes
 * KV reuse from the boundary.
 *
 * COST CAVEAT: llama.cpp's llama_state_save_file serializes the token list
 * truncated at tokenSize but the FULL KV tensor state of every occupied cell
 * (the tail/history/answer cells too — there is no per-token trim in the save
 * path). For Qwen3-4B with f16 KV that is ~147 KB/token, so the file runs to
 * hundreds of MB and the write takes on the order of a second. The extra cells
 * are dead weight (loadSession's next completion purges what doesn't match)
 * but they make saves expensive — which is why session-cache debounces them.
 *
 * Runs as ONE lock acquisition, and callers must invoke it SYNCHRONOUSLY in
 * the same tick as the decision to persist: any completion that slips in
 * between could ctx_shift the prefix out of the cache and persist garbage.
 * Callers must only invoke this after a completion whose prompt began with
 * `prefixText` (the orchestrator's post-turn hook guarantees it).
 *
 * Returns the number of tokens the boundary covers (the reusable region).
 */
export function snapshotPrefixSession(opts: {
  path: string;
  prefixText: string;
  probeTailA: string;
  probeTailB: string;
}): Promise<number> {
  return withLock(async () => {
    if (!context) throw new Error("No model loaded");
    if (!kvStateDirty) throw new Error("No completion has populated the KV cache");

    // Sequential on purpose: two concurrent JSI calls on one context are not
    // guaranteed safe, and this whole op already holds the engine lock.
    // The fixed user message keeps templates that dislike system-only chats
    // happy; being identical in both probes, it cannot move the boundary.
    // Each probe also gets a DIFFERENT template `now`: a chat template that
    // itself injects the current date (some imported GGUFs do) then diverges
    // at that date, the boundary lands before it, and the <64 guard below
    // correctly refuses to persist a prefix that goes stale at midnight.
    const PROBE_NOW = [946684800, 4102444800]; // epoch 2000-01-01 / 2100-01-01
    const probes: number[][] = [];
    for (const [i, tail] of [opts.probeTailA, opts.probeTailB].entries()) {
      const formatted = await context.getFormattedChat(
        [
          { role: "system", content: opts.prefixText + tail },
          { role: "user", content: "." },
        ],
        undefined,
        { now: PROBE_NOW[i] },
      );
      probes.push((await context.tokenize(formatted.prompt)).tokens);
    }
    const boundary = commonPrefixLength(probes[0], probes[1]);
    // A tiny boundary means the probes diverged inside the stable prefix —
    // wrong inputs, or a template that injects time itself. Don't persist that.
    if (boundary < 64) {
      throw new Error(`Stable-prefix boundary too short: ${boundary} tokens`);
    }

    // llama.rn 0.11.4 strips file:// in loadSession but NOT in saveSession —
    // normalize here so both accept the same expo-file-system URI form.
    const rawPath = opts.path.startsWith("file://") ? opts.path.slice(7) : opts.path;
    await context.saveSession(rawPath, { tokenSize: boundary });
    return boundary;
  });
}

export function stopGeneration(): Promise<void> {
  // Record the user's intent so the active generate() reports stoppedByUser and
  // callers (e.g. the orchestrator's malformed-JSON retry) can avoid launching
  // follow-up work the user just asked to cancel.
  stopRequested = true;
  // stopCompletion is safe to call outside the lock (it signals the native layer).
  // It's a JSI call typed Promise<void> but can return undefined at runtime, so
  // wrap in Promise.resolve to guarantee callers always get a thenable.
  if (context) {
    return Promise.resolve(context.stopCompletion());
  }
  return Promise.resolve();
}
