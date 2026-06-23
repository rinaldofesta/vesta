// Resumable GGUF downloader built on expo-file-system's createDownloadResumable.
// No native code — this replaces anti-vocale's Kotlin ResumeDownloadHelper +
// DownloadRetryHelper + ProgressThrottler entirely in TypeScript.
//
// Key behaviours:
//  - downloads DIRECT to `<final>.download` then renames to `<final>` (no
//    double-disk-copy: the file never exists twice except briefly at rename),
//  - free-space preflight before starting,
//  - progress throttled to ~1/sec with a sliding bytes/sec + ETA,
//  - pause/resume across app restarts via the saved resume token,
//  - size verification against the authoritative HF byte size before commit.

import * as FileSystem from "expo-file-system/legacy";
import { computeRate, etaSeconds, hasEnoughSpace } from "./format";

export const MODELS_DIR = FileSystem.documentDirectory + "models/";

export function modelPathFor(fileName: string): string {
  return MODELS_DIR + fileName;
}

export function tempPathFor(finalPath: string): string {
  return finalPath + ".download";
}

const PROGRESS_INTERVAL_MS = 800;
// Accept a tiny mismatch (some CDNs report size off by a few bytes); a real
// truncation is far larger than this.
const SIZE_TOLERANCE_BYTES = 1024;

interface ActiveTask {
  task: FileSystem.DownloadResumable;
  canceled: boolean;
}

const active = new Map<string, ActiveTask>();

export interface DownloadParams {
  modelId: string;
  url: string;
  fileName: string; // final name inside MODELS_DIR
  expectedBytes: number; // 0 = unknown (skip preflight + size verify)
  // Whether expectedBytes is authoritative (from the HF tree API) and may be
  // used to reject a truncated download. False for the catalog's approximate
  // size, which must not fail a genuinely complete download.
  verifySize?: boolean;
  headers?: Record<string, string>;
  resumeToken?: string | null;
  onProgress?: (p: {
    bytesWritten: number;
    bytesTotal: number;
    bytesPerSec: number;
    etaSeconds: number | null;
  }) => void;
  onResumeToken?: (token: string) => void;
}

export interface DownloadOutcome {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  sizeBytes?: number;
  error?: string;
}

export async function ensureModelsDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MODELS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
  }
}

export async function getFreeBytes(): Promise<number> {
  try {
    return await FileSystem.getFreeDiskStorageAsync();
  } catch {
    return Number.POSITIVE_INFINITY; // unknown — don't block on it
  }
}

export function isDownloading(modelId: string): boolean {
  return active.has(modelId);
}

export async function downloadModel(
  params: DownloadParams,
): Promise<DownloadOutcome> {
  const {
    modelId,
    url,
    fileName,
    expectedBytes,
    verifySize = true,
    headers,
    resumeToken,
    onProgress,
    onResumeToken,
  } = params;

  await ensureModelsDir();

  if (expectedBytes > 0) {
    const free = await getFreeBytes();
    if (!hasEnoughSpace(free, expectedBytes)) {
      return {
        ok: false,
        error: `Not enough free space — need ~${Math.ceil(
          (expectedBytes * 1.1) / 1e9,
        )} GB.`,
      };
    }
  }

  const finalPath = modelPathFor(fileName);
  const tempPath = tempPathFor(finalPath);

  // Throttled progress + sliding-window rate/ETA.
  let lastEmit = 0;
  let prevMs = Date.now();
  let prevBytes = 0;
  let rate = 0;

  const callback = (data: FileSystem.DownloadProgressData) => {
    const now = Date.now();
    const written = data.totalBytesWritten;
    const total = data.totalBytesExpectedToWrite;
    const instant = computeRate(prevBytes, prevMs, written, now);
    // Smooth the rate so the ETA doesn't jitter.
    rate = rate === 0 ? instant : rate * 0.7 + instant * 0.3;
    prevMs = now;
    prevBytes = written;
    if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
      lastEmit = now;
      onProgress?.({
        bytesWritten: written,
        bytesTotal: total > 0 ? total : expectedBytes,
        bytesPerSec: rate,
        etaSeconds: etaSeconds(written, total > 0 ? total : expectedBytes, rate),
      });
    }
  };

  const task = FileSystem.createDownloadResumable(
    url,
    tempPath,
    headers ? { headers } : {},
    callback,
    resumeToken ?? undefined,
  );

  const entry: ActiveTask = { task, canceled: false };
  active.set(modelId, entry);

  try {
    const result = resumeToken
      ? await task.resumeAsync()
      : await task.downloadAsync();

    // undefined => the task was paused or canceled.
    if (!result) {
      if (entry.canceled) {
        await safeDelete(tempPath);
        return { ok: false, canceled: true };
      }
      // Paused: persist the resume token so we can continue later.
      try {
        const token = task.savable().resumeData;
        if (token) onResumeToken?.(token);
      } catch {
        /* best-effort */
      }
      return { ok: false, canceled: true };
    }

    // Verify the downloaded file before committing it as the model.
    const info = await FileSystem.getInfoAsync(tempPath);
    if (!info.exists) {
      return { ok: false, error: "Downloaded file is missing." };
    }
    const actualSize = info.size ?? 0;
    // Only reject against an authoritative size; the catalog's approximate size
    // must never fail a complete download. A truncation is always smaller.
    if (
      verifySize &&
      expectedBytes > 0 &&
      actualSize < expectedBytes - SIZE_TOLERANCE_BYTES
    ) {
      await safeDelete(tempPath);
      return {
        ok: false,
        error: `Download incomplete (${actualSize} of ${expectedBytes} bytes). Try again.`,
      };
    }

    // Commit: replace any existing final file with the verified temp file.
    await safeDelete(finalPath);
    await FileSystem.moveAsync({ from: tempPath, to: finalPath });

    // Final 100% tick.
    onProgress?.({
      bytesWritten: actualSize,
      bytesTotal: actualSize,
      bytesPerSec: rate,
      etaSeconds: 0,
    });

    return { ok: true, filePath: finalPath, sizeBytes: actualSize };
  } catch (err) {
    if (entry.canceled) {
      await safeDelete(tempPath);
      return { ok: false, canceled: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    active.delete(modelId);
  }
}

export async function cancelDownload(modelId: string): Promise<void> {
  const entry = active.get(modelId);
  if (!entry) return;
  entry.canceled = true;
  try {
    await entry.task.cancelAsync();
  } catch {
    /* already finished */
  }
  active.delete(modelId);
}

// Pause and return the resume token (to persist), or null if not pausable.
export async function pauseDownload(modelId: string): Promise<string | null> {
  const entry = active.get(modelId);
  if (!entry) return null;
  try {
    const state = await entry.task.pauseAsync();
    return state.resumeData ?? null;
  } catch {
    return null;
  }
}

export async function deleteModelFile(filePath: string): Promise<void> {
  await safeDelete(filePath);
  await safeDelete(tempPathFor(filePath));
}

async function safeDelete(path: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    /* best-effort cleanup */
  }
}
