// LLM Engine — TypeScript adapter wrapping llama.rn into Vesta's interface.
// Handles model lifecycle (load/unload) and completion with streaming support.

import {
  initLlama,
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
}

const DEFAULT_OPTIONS: Required<LlmOptions> = {
  contextSize: 4096,
  gpuLayers: 0,
  threads: 4,
  useMlock: false,
};

const DEFAULT_GENERATE: Required<GenerateOptions> = {
  maxTokens: 4096,
  temperature: 0.7,
  topP: 0.95,
  stopSequences: [],
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

export function getModelInfo(): ModelInfo {
  return {
    loaded: context !== null,
    path: currentModelPath ?? undefined,
  };
}

export function isLoaded(): boolean {
  return context !== null;
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
    context = await initLlama(
      {
        model: modelPath,
        n_ctx: opts.contextSize,
        n_gpu_layers: opts.gpuLayers,
        n_threads: opts.threads,
        use_mlock: opts.useMlock,
      },
      onProgress,
    );
    currentModelPath = modelPath;
  });
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
        stop: opts.stopSequences.length > 0 ? opts.stopSequences : undefined,
      },
      onToken
        ? (data: TokenData) => {
            if (data.token) onToken(data.token);
          }
        : undefined,
    );

    // Use `content` (filtered text without reasoning) as primary output.
    // Fall back to `text` (raw output) if content is null/undefined.
    const text = result.content ?? result.text;

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
    };
  });
}

export function stopGeneration(): Promise<void> {
  // stopCompletion is safe to call outside the lock (it signals the native layer)
  if (context) {
    return context.stopCompletion();
  }
  return Promise.resolve();
}
