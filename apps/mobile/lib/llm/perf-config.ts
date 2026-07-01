// User-tunable inference performance settings, persisted in the config table and
// applied at model load. Defaults preserve current behavior — users opt into
// tweaks, and the model reloads to apply them.

import { getConfig, setConfig } from "../storage/database";
import type { LlmOptions } from "./types";

export interface PerfSettings {
  threads: number;
  useMlock: boolean;
  kvQuant: boolean; // q8_0 KV cache when true (halves KV RAM)
}

export const DEFAULT_PERF: PerfSettings = {
  threads: 4,
  useMlock: false,
  kvQuant: false,
};

const KEY = "perf_settings";

export async function getPerfSettings(): Promise<PerfSettings> {
  try {
    const raw = await getConfig(KEY);
    if (!raw) return { ...DEFAULT_PERF };
    return { ...DEFAULT_PERF, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PERF };
  }
}

export async function setPerfSettings(s: PerfSettings): Promise<void> {
  await setConfig(KEY, JSON.stringify(s));
}

// Map perf settings to the LlmOptions subset the engine reads at load time.
export function perfToLlmOptions(s: PerfSettings): Partial<LlmOptions> {
  return {
    threads: s.threads,
    useMlock: s.useMlock,
    kvCacheType: s.kvQuant ? "q8_0" : undefined,
  };
}
