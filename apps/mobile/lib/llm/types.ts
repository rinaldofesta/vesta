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
}

export interface ModelInfo {
  loaded: boolean;
  path?: string;
}
