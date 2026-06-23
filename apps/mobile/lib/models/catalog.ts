// Curated starter catalog — the offline-browsable "Recommended" list.
//
// Each entry's exact downloadable file is resolved LIVE against the HuggingFace
// repo tree at download time (see hf-client.listGgufFiles), so `preferredFile`
// is only a hint: if a repo renames/re-quantizes its files, the user still
// picks from the live `.gguf` list and nothing 404s silently.
//
// Sizes are approximate (the live tree gives the authoritative byte size used
// for the free-space preflight). Keep this list small and high-signal — it is
// just a typed constant and is trivial to extend.

import type { CatalogModel } from "./types";

const APACHE = "https://www.apache.org/licenses/LICENSE-2.0";

export const CATALOG: CatalogModel[] = [
  {
    id: "qwen3-1.7b-q4",
    displayName: "Qwen3 1.7B",
    description:
      "Smallest option. Fast and light — good for low-RAM phones, weaker at complex tool calls.",
    hfRepo: "Qwen/Qwen3-1.7B-GGUF",
    preferredFile: "Qwen3-1.7B-Q4_K_M.gguf",
    quant: "Q4_K_M",
    sizeBytesApprox: 1_100_000_000,
    minRamMb: 3072,
    paramsB: 1.7,
    contextSize: 4096,
    role: "primary",
    recommendedFor: "phone",
    supportsTools: true,
    license: "Apache-2.0",
    licenseUrl: APACHE,
  },
  {
    id: "qwen3-4b-q4",
    displayName: "Qwen3 4B",
    description:
      "Recommended for phones. Best balance of quality and speed for Vesta's tool calls and chat.",
    hfRepo: "Qwen/Qwen3-4B-GGUF",
    preferredFile: "Qwen3-4B-Q4_K_M.gguf",
    quant: "Q4_K_M",
    sizeBytesApprox: 2_500_000_000,
    minRamMb: 4096,
    paramsB: 4,
    contextSize: 4096,
    role: "primary",
    recommendedFor: "phone",
    supportsTools: true,
    license: "Apache-2.0",
    licenseUrl: APACHE,
  },
  {
    id: "qwen3-8b-q4",
    displayName: "Qwen3 8B",
    description:
      "Recommended for tablets / high-RAM devices. Higher quality, needs ~6 GB+ free RAM.",
    hfRepo: "Qwen/Qwen3-8B-GGUF",
    preferredFile: "Qwen3-8B-Q4_K_M.gguf",
    quant: "Q4_K_M",
    sizeBytesApprox: 5_000_000_000,
    minRamMb: 8192,
    paramsB: 8,
    contextSize: 4096,
    role: "primary",
    recommendedFor: "tablet",
    supportsTools: true,
    license: "Apache-2.0",
    licenseUrl: APACHE,
  },
  {
    id: "nomic-embed-v1.5-q4",
    displayName: "Nomic Embed v1.5",
    description:
      "Embedding model for on-device document search (RAG). Tiny — pair it with a chat model.",
    hfRepo: "nomic-ai/nomic-embed-text-v1.5-GGUF",
    preferredFile: "nomic-embed-text-v1.5.Q4_K_M.gguf",
    quant: "Q4_K_M",
    sizeBytesApprox: 90_000_000,
    minRamMb: 1024,
    paramsB: 0.1,
    contextSize: 2048,
    role: "embedding",
    recommendedFor: "any",
    supportsTools: false,
    license: "Apache-2.0",
    licenseUrl: APACHE,
  },
];

export function getCatalogModel(id: string): CatalogModel | undefined {
  return CATALOG.find((m) => m.id === id);
}
