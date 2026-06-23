export interface LlmOptions {
  contextSize?: number;
  gpuLayers?: number;
  threads?: number;
  useMlock?: boolean;
  // Optional per-model chat template (Jinja). When a GGUF ships a wrong/missing
  // template, pass the correct one so tool-call JSON stays parseable.
  chatTemplate?: string;
}

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  // When false, suppresses Qwen3-style chain-of-thought for this turn (faster).
  // Leave undefined to use the model's default (thinking on).
  enableThinking?: boolean;
}

export interface ModelInfo {
  loaded: boolean;
  path?: string;
}
