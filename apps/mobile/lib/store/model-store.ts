// Zustand store for the model manager. Coordinates the catalog, HuggingFace
// download, the SQLite registry, and llama.rn (load/unload), and exposes live
// download progress to the Models screen.

import { create } from "zustand";
import * as FileSystem from "expo-file-system/legacy";
import type { CatalogModel, DownloadProgress, InstalledModel } from "../models/types";
import {
  listInstalled,
  getModelById,
  getActiveModel,
  insertModel,
  setModelState,
  setResumeToken,
  finalizeModel,
  setActiveModel,
  removeModel,
} from "../models/model-registry";
import {
  downloadModel,
  cancelDownload as cancelTask,
  deleteModelFile,
  ensureModelsDir,
  modelPathFor,
} from "../models/download-manager";
import { listGgufFiles, resolveUrl, type HfFile } from "../models/hf-client";
import { getDeviceCaps, type DeviceCaps } from "../models/device-caps";
import { loadModel, unloadModel, validateGguf } from "../llm/llm-engine";
import { useChatStore } from "./chat-store";

// Pure: choose which file in a repo to download. Exact filename wins, then a
// filename containing the desired quant, then the first GGUF.
export function pickFile(
  files: HfFile[],
  preferred: string,
  quant: string,
): HfFile | null {
  if (files.length === 0) return null;
  const base = (p: string) => p.split("/").pop() ?? p;
  const exact = files.find(
    (f) => base(f.path).toLowerCase() === preferred.toLowerCase(),
  );
  if (exact) return exact;
  const byQuant = files.find((f) =>
    base(f.path).toLowerCase().includes(quant.toLowerCase()),
  );
  if (byQuant) return byQuant;
  return files[0];
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

interface ModelState {
  installed: InstalledModel[];
  progress: Record<string, DownloadProgress>;
  freeBytes: number | null;
  caps: DeviceCaps | null;
  busy: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  downloadFromCatalog: (model: CatalogModel) => Promise<void>;
  downloadFromRepo: (
    repo: string,
    file: HfFile,
    displayName: string,
  ) => Promise<void>;
  importLocalModel: (uri: string, name: string) => Promise<void>;
  activate: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useModelStore = create<ModelState>((set, get) => ({
  installed: [],
  progress: {},
  freeBytes: null,
  caps: null,
  busy: false,
  error: null,

  refresh: async () => {
    const [installed, caps] = await Promise.all([listInstalled(), getDeviceCaps()]);
    set({
      installed,
      caps,
      freeBytes: Number.isFinite(caps.freeBytes) ? caps.freeBytes : null,
    });
  },

  downloadFromCatalog: async (model: CatalogModel) => {
    set({ error: null });

    // Resolve the actual downloadable file from the live repo tree; fall back to
    // the catalog hint if the network/listing is unavailable.
    let file: HfFile;
    try {
      const files = await listGgufFiles(model.hfRepo);
      const picked = pickFile(files, model.preferredFile, model.quant);
      if (!picked) throw new Error("No .gguf files found in this repo.");
      file = picked;
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "GATED") {
        set({
          error: `${model.displayName} requires a HuggingFace login (gated). Support coming soon.`,
        });
        return;
      }
      // Network/listing failure — fall back to the catalog's best guess.
      file = {
        path: model.preferredFile,
        sizeBytes: model.sizeBytesApprox,
        sha256: null,
      };
    }

    await runDownload(set, get, {
      repo: model.hfRepo,
      file,
      displayName: model.displayName,
      quant: model.quant,
      minRamMb: model.minRamMb,
      contextSize: model.contextSize,
      role: model.role,
    });
  },

  downloadFromRepo: async (repo, file, displayName) => {
    set({ error: null });
    await runDownload(set, get, {
      repo,
      file,
      displayName,
      quant: null,
      minRamMb: null,
      contextSize: 4096,
      role: "primary",
    });
  },

  importLocalModel: async (uri: string, name: string) => {
    set({ busy: true, error: null });
    try {
      await ensureModelsDir();
      const fileName = name.endsWith(".gguf") ? name : `${name}.gguf`;
      const finalPath = modelPathFor(fileName);
      // Single copy straight to the final path (no temp-then-load double write).
      const existing = await FileSystem.getInfoAsync(finalPath);
      if (!existing.exists) {
        await FileSystem.copyAsync({ from: uri, to: finalPath });
      }

      const valid = await validateGguf(finalPath);
      if (!valid.ok) {
        await deleteModelFile(finalPath);
        set({ error: valid.error ?? "Invalid GGUF file." });
        return;
      }

      const info = await FileSystem.getInfoAsync(finalPath);
      const model = await insertModel({
        displayName: fileName.replace(/\.gguf$/i, ""),
        filePath: finalPath,
        hfFile: fileName,
        sizeBytes: info.exists ? (info.size ?? 0) : 0,
        contextSize: 4096,
        role: "primary",
        state: "ready",
      });

      await get().refresh();
      const active = await getActiveModel();
      if (!active) await get().activate(model.id);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ busy: false });
    }
  },

  activate: async (id: string) => {
    set({ error: null });
    const model = await getModelById(id);
    if (!model || model.state !== "ready") {
      set({ error: "Model is not ready." });
      return;
    }
    const info = await FileSystem.getInfoAsync(model.filePath);
    if (!info.exists) {
      await setModelState(id, "error");
      await get().refresh();
      set({ error: "Model file is missing — re-download it." });
      return;
    }
    try {
      await loadModel(model.filePath, {
        contextSize: model.contextSize,
        gpuLayers: 0,
        chatTemplate: model.chatTemplate ?? undefined,
      });
      await setActiveModel(id);
      useChatStore.getState().updateModelStatus();
      await get().refresh();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  remove: async (id: string) => {
    const model = await getModelById(id);
    if (!model) return;
    if (model.isActive) {
      await unloadModel().catch(() => {});
      useChatStore.getState().updateModelStatus();
    }
    await deleteModelFile(model.filePath);
    await removeModel(id);
    await get().refresh();
  },

  cancel: async (id: string) => {
    await cancelTask(id);
    const model = await getModelById(id);
    if (model) {
      await deleteModelFile(model.filePath);
      await removeModel(id);
    }
    set((s) => {
      const progress = { ...s.progress };
      delete progress[id];
      return { progress };
    });
    await get().refresh();
  },

  clearError: () => set({ error: null }),
}));

// Shared download flow for catalog + ad-hoc repo downloads.
async function runDownload(
  set: (partial: Partial<ModelState> | ((s: ModelState) => Partial<ModelState>)) => void,
  get: () => ModelState,
  args: {
    repo: string;
    file: HfFile;
    displayName: string;
    quant: string | null;
    minRamMb: number | null;
    contextSize: number;
    role: InstalledModel["role"];
  },
): Promise<void> {
  const fileName = baseName(args.file.path);
  const model = await insertModel({
    displayName: args.displayName,
    hfRepo: args.repo,
    hfFile: fileName,
    filePath: modelPathFor(fileName),
    quant: args.quant,
    sizeBytes: args.file.sizeBytes,
    minRamMb: args.minRamMb,
    sha256: args.file.sha256,
    contextSize: args.contextSize,
    role: args.role,
    state: "downloading",
  });

  const id = model.id;
  set((s) => ({
    progress: {
      ...s.progress,
      [id]: {
        modelId: id,
        status: "downloading",
        bytesWritten: 0,
        bytesTotal: args.file.sizeBytes,
        bytesPerSec: 0,
        etaSeconds: null,
      },
    },
  }));
  await get().refresh();

  const outcome = await downloadModel({
    modelId: id,
    url: resolveUrl(args.repo, args.file.path),
    fileName,
    expectedBytes: args.file.sizeBytes,
    onProgress: (p) =>
      set((s) => ({
        progress: {
          ...s.progress,
          [id]: { modelId: id, status: "downloading", ...p },
        },
      })),
    onResumeToken: (token) => {
      setResumeToken(id, token).catch(() => {});
    },
  });

  // If the row was removed mid-flight (user cancel), stop here.
  const stillExists = await getModelById(id);
  if (!stillExists) return;

  if (outcome.canceled) {
    await setModelState(id, "paused");
    await get().refresh();
    return;
  }

  if (!outcome.ok) {
    await setModelState(id, "error");
    set((s) => ({
      progress: {
        ...s.progress,
        [id]: { ...s.progress[id], status: "error", error: outcome.error },
      },
    }));
    await get().refresh();
    set({ error: outcome.error ?? "Download failed." });
    return;
  }

  // Verify it actually loads as a GGUF before marking ready.
  const valid = await validateGguf(outcome.filePath!);
  if (!valid.ok) {
    await deleteModelFile(outcome.filePath!);
    await setModelState(id, "error");
    await get().refresh();
    set({ error: valid.error ?? "Downloaded file is not a valid model." });
    return;
  }

  await finalizeModel(id, {
    filePath: outcome.filePath,
    sizeBytes: outcome.sizeBytes,
  });
  set((s) => {
    const progress = { ...s.progress };
    delete progress[id];
    return { progress };
  });
  await get().refresh();

  // Auto-activate the first model the user installs.
  const active = await getActiveModel();
  if (!active) await get().activate(id);
}
