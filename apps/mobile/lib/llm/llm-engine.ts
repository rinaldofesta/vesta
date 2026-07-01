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
        // Only override the embedded template when one is explicitly provided.
        ...(options?.chatTemplate ? { chat_template: options.chatTemplate } : {}),
      },
      onProgress,
    );
    currentModelPath = modelPath;
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
