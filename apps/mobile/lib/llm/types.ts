export interface LlmOptions {
  contextSize?: number;
  gpuLayers?: number;
  threads?: number;
  useMlock?: boolean;
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
