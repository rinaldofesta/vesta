// Cold-start persistent prefix cache (Fase 4).
//
// llama.rn already reuses the in-memory KV cache across completions sharing a
// token prefix, so warm turns are cheap — but the FIRST turn after an app
// launch prefills the whole stable prefix (~1450 tokens, ~33s measured on a
// Pixel 10 Pro). This module persists that prefix's KV state to disk and
// restores it right after model load, so a cold launch pays only the first
// user message (from the time-derived divergence point inside its
// [Contesto temporale: ...] line — the V4 system prompt itself is static).
//
// Policy (this file) vs mechanics (llm-engine):
// - The session file is keyed by hash(modelPath + KV cache type + stable
//   prefix text). Any change to the model, the KV-quant perf setting, the
//   language, memories, or knowledge files changes the hash, which
//   invalidates the file; a later clean turn re-saves it.
// - Saving happens AFTER a normal user turn — the prefix KV is already in
//   memory then, so persisting costs one disk write and zero extra prefill.
//   That write is NOT small: llama.cpp serializes the full KV state (hundreds
//   of MB for Qwen3-4B f16 — see snapshotPrefixSession), so saves are
//   debounced and skipped entirely while the on-disk hash already matches.
// - Restoring happens once, between model load and the first completion
//   (llm-engine refuses to load a session over live conversation state), and
//   the restored content is VALIDATED against the expected prefix text — a
//   file whose tokens don't start with the prefix is deleted, not trusted.
// - Every failure path degrades to "start cold", never to a broken state.

import * as FileSystem from "expo-file-system/legacy";
import {
  getKvCacheType,
  getModelInfo,
  loadSessionFile,
  snapshotPrefixSession,
} from "./llm-engine";

const CACHE_DIR = FileSystem.documentDirectory + "session-cache/";
const SESSION_FILE = CACHE_DIR + "prefix.bin";
const META_FILE = CACHE_DIR + "prefix-meta.json";
const META_VERSION = 1;
// Full-KV-state writes are expensive (see header) — bound how often memory
// churn (each extracted memory changes the prefix hash) can trigger them.
const PERSIST_DEBOUNCE_MS = 120_000;
// How many leading characters of the stable prefix the restored session text
// must contain to be trusted. The formatted prompt wraps the prefix in
// template tokens, so `includes` (not startsWith) over a long head is used.
const VALIDATE_HEAD_CHARS = 300;

interface SessionMeta {
  version: number;
  modelPath: string;
  prefixHash: string;
  tokenCount: number;
  savedAt: number;
}

// What this session knows about the file on disk:
//   undefined — never checked (restore hasn't run); string — valid cache with
//   that prefix hash; null — no valid cache (missing, stale-deleted, corrupt).
// persistPrefixSession's skip check reads this SYNCHRONOUSLY so the snapshot
// can enqueue on the engine lock in the same tick as the turn that scheduled
// it — an await before the lock would let memory extraction (or a fast next
// turn) interleave ahead of the snapshot.
let knownDiskHash: string | null | undefined = undefined;
let lastPersistAt = 0;

// FNV-1a 32-bit over UTF-16 code units. Not cryptographic — it only needs to
// detect that the model or prefix text changed, with no adversary involved.
export function fnv1aHex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function cacheKey(modelPath: string, stablePrefix: string): string {
  // The KV cache type is part of the key: session files store KV cells in the
  // loaded context's type, so restoring an f16 file into a q8_0 context (or
  // vice versa after a perf-settings change) must miss instead of erroring.
  return fnv1aHex(
    modelPath + "\u0000" + getKvCacheType() + "\u0000" + stablePrefix,
  );
}

async function readMeta(): Promise<SessionMeta | null> {
  try {
    const info = await FileSystem.getInfoAsync(META_FILE);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(META_FILE));
    if (
      parsed?.version !== META_VERSION ||
      typeof parsed.modelPath !== "string" ||
      typeof parsed.prefixHash !== "string" ||
      typeof parsed.tokenCount !== "number"
    ) {
      return null;
    }
    return parsed as SessionMeta;
  } catch {
    return null;
  }
}

// Meta FIRST, bin second: if the process dies between the two deletes, a
// leftover bin with no meta is inert, while a leftover meta with no bin used
// to wedge the cache (restore found a matching meta, persist skipped forever).
async function deleteCacheFiles(): Promise<void> {
  await FileSystem.deleteAsync(META_FILE, { idempotent: true }).catch(() => {});
  await FileSystem.deleteAsync(SESSION_FILE, { idempotent: true }).catch(() => {});
}

async function ensureCacheDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

/** Dev helper (/session-clear): wipe the cache so a cold launch can be measured. */
export async function clearPrefixSessionCache(): Promise<void> {
  await deleteCacheFiles();
  knownDiskHash = null;
  lastPersistAt = 0;
}

/**
 * Restore the persisted prefix KV state for the loaded model, if the cached
 * file matches the current stable prefix. Call once per model load, BEFORE
 * any completion. Also primes the in-memory disk-hash snapshot that
 * persistPrefixSession's synchronous skip check relies on.
 * Returns the number of tokens restored, or null when there was nothing valid
 * to restore (missing/stale/corrupt file, or a completion already ran).
 */
export async function restorePrefixSession(
  stablePrefix: string,
): Promise<number | null> {
  const modelPath = getModelInfo().path;
  if (!modelPath) return null;

  // Create the dir here (every launch path goes through restore) so the
  // persist path never needs an await before reaching the engine lock.
  await ensureCacheDir().catch(() => {});

  const meta = await readMeta();
  if (!meta) {
    knownDiskHash = null;
    return null;
  }
  const binInfo = await FileSystem.getInfoAsync(SESSION_FILE);
  if (!binInfo.exists) {
    // Orphaned meta (e.g. process killed mid-delete): remove it so nothing
    // ever treats this half-state as a valid cache.
    await deleteCacheFiles();
    knownDiskHash = null;
    return null;
  }
  if (meta.prefixHash !== cacheKey(modelPath, stablePrefix)) {
    // Stale is normal (new memory, model switch, prompt edit) — keep the
    // files; a later clean turn overwrites them.
    knownDiskHash = meta.prefixHash;
    return null;
  }

  try {
    const restored = await loadSessionFile(SESSION_FILE);
    if (restored === null) {
      // A completion beat us to the KV cache — file untouched and still valid.
      knownDiskHash = meta.prefixHash;
      return null;
    }
    // Content validation: the detokenized restored tokens must actually carry
    // the expected prefix text. A mismatching file (however it was produced)
    // would otherwise be restored uselessly on every launch — the hash covers
    // the prefix TEXT, not the file content.
    if (
      restored.tokensLoaded < 64 ||
      !restored.prompt.includes(stablePrefix.slice(0, VALIDATE_HEAD_CHARS))
    ) {
      console.warn(
        `[SessionCache] restored content mismatch (${restored.tokensLoaded} tokens) — deleting cache`,
      );
      await deleteCacheFiles();
      knownDiskHash = null;
      return null;
    }
    knownDiskHash = meta.prefixHash;
    console.log(
      `[SessionCache] restored ${restored.tokensLoaded} prefix tokens from disk (saved ${meta.tokenCount})`,
    );
    return restored.tokensLoaded;
  } catch (err) {
    // Corrupt or incompatible file (e.g. llama.cpp session format bump):
    // delete it so we don't retry every launch, and start cold.
    console.warn("[SessionCache] restore failed, deleting cache:", err);
    await deleteCacheFiles();
    knownDiskHash = null;
    return null;
  }
}

// Prevent concurrent persists (each clean turn schedules one).
let persistRunning = false;

/**
 * Persist the current stable prefix's KV state if the on-disk cache doesn't
 * already match it. Fire-and-forget from the orchestrator after a clean turn.
 *
 * The skip checks and the snapshot call are SYNCHRONOUS up to the engine-lock
 * enqueue: the snapshot must enter the lock queue in the same tick as the
 * turn that scheduled it, ahead of memory extraction and any next user turn,
 * so it captures a KV state that provably starts with the stable prefix.
 *
 * Returns the number of tokens saved, or null when skipped.
 */
export async function persistPrefixSession(
  stablePrefix: string,
  probeUserA: string,
  probeUserB: string,
): Promise<number | null> {
  const modelPath = getModelInfo().path;
  if (!modelPath) return null;
  const hash = cacheKey(modelPath, stablePrefix);
  if (persistRunning) return null;
  if (knownDiskHash === hash) return null; // already cached
  if (Date.now() - lastPersistAt < PERSIST_DEBOUNCE_MS) return null; // debounce
  persistRunning = true;

  try {
    // Engine-lock enqueue happens inside this call, still in the current tick.
    const tokenCount = await snapshotPrefixSession({
      path: SESSION_FILE,
      prefixText: stablePrefix,
      probeUserA,
      probeUserB,
    });

    const newMeta: SessionMeta = {
      version: META_VERSION,
      modelPath,
      prefixHash: hash,
      tokenCount,
      savedAt: Date.now(),
    };
    await FileSystem.writeAsStringAsync(META_FILE, JSON.stringify(newMeta));
    knownDiskHash = hash;
    lastPersistAt = Date.now();
    console.log(`[SessionCache] saved ${tokenCount} prefix tokens to disk`);
    return tokenCount;
  } catch (err) {
    // A failed save may leave a partial session file — remove both files so
    // the next launch cannot restore garbage.
    console.warn("[SessionCache] save failed:", err);
    await deleteCacheFiles();
    knownDiskHash = null;
    return null;
  } finally {
    persistRunning = false;
  }
}
