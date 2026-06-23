// Shared types for the in-app model manager (discovery, download, selection).
// Android-first, but all pure TypeScript so it carries to iOS later.

export type ModelRole = "primary" | "router" | "embedding";
export type RecommendedFor = "phone" | "tablet" | "any";

// A curated, bundled catalog entry. Static — works fully offline for browsing.
// The exact downloadable file is resolved live against the HF repo tree at
// download time, so a drifted `preferredFile` never blocks the user.
export interface CatalogModel {
  id: string; // stable catalog id, e.g. "qwen3-4b"
  displayName: string;
  description: string;
  hfRepo: string; // e.g. "Qwen/Qwen3-4B-GGUF"
  preferredFile: string; // best-known .gguf filename (verified live)
  quant: string; // e.g. "Q4_K_M"
  sizeBytesApprox: number;
  minRamMb: number; // RAM the device should have to run this comfortably
  paramsB: number; // billions of parameters
  contextSize: number; // default n_ctx to load with
  role: ModelRole;
  recommendedFor: RecommendedFor;
  supportsTools: boolean;
  license: string;
  licenseUrl?: string;
}

export type DownloadStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "paused"
  | "verifying"
  | "ready"
  | "error"
  | "canceled";

// A model the user has installed (downloaded or imported). Backed by the
// `models` SQLite table — the single source of truth, replacing the old
// bare `model_path` config key.
export interface InstalledModel {
  id: string; // uuid
  displayName: string;
  hfRepo: string | null;
  hfFile: string | null;
  filePath: string;
  quant: string | null;
  sizeBytes: number;
  minRamMb: number | null;
  chatTemplate: string | null;
  contextSize: number;
  role: ModelRole;
  state: DownloadStatus;
  resumeToken: string | null;
  sha256: string | null;
  isActive: boolean;
  createdAt: number;
}

// Live download progress, surfaced to the UI via the model store.
export interface DownloadProgress {
  modelId: string;
  status: DownloadStatus;
  bytesWritten: number;
  bytesTotal: number;
  bytesPerSec: number;
  etaSeconds: number | null;
  error?: string;
}
