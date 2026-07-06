// Tests the cold-start prefix cache POLICY: hash keying, staleness detection,
// restore-time content validation, corrupt-file recovery, debounce, and the
// persist/restore round trip. The llama.rn mechanics (snapshotPrefixSession /
// loadSessionFile) are mocked — on-device behavior is covered by the Fase 4
// spot checks, not jest.

// In-memory expo-file-system fake. Paths are the full file:// URIs the module
// builds from documentDirectory.
jest.mock("expo-file-system/legacy", () => {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    documentDirectory: "file:///docs/",
    getInfoAsync: jest.fn(async (path: string) => ({
      exists: files.has(path) || dirs.has(path),
    })),
    readAsStringAsync: jest.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error("ENOENT: " + path);
      return content;
    }),
    writeAsStringAsync: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    deleteAsync: jest.fn(async (path: string) => {
      files.delete(path);
      dirs.delete(path);
    }),
    makeDirectoryAsync: jest.fn(async (path: string) => {
      dirs.add(path);
    }),
    __files: files,
    __dirs: dirs,
  };
});

jest.mock("../llm-engine", () => ({
  getKvCacheType: jest.fn(() => "f16"),
  getModelInfo: jest.fn(),
  loadSessionFile: jest.fn(),
  snapshotPrefixSession: jest.fn(),
}));

import {
  fnv1aHex,
  restorePrefixSession,
  persistPrefixSession,
  clearPrefixSessionCache,
} from "../session-cache";
import {
  getKvCacheType,
  getModelInfo,
  loadSessionFile,
  snapshotPrefixSession,
} from "../llm-engine";

const fs = jest.requireMock("expo-file-system/legacy");
const mockModelInfo = getModelInfo as jest.MockedFunction<typeof getModelInfo>;
const mockLoad = loadSessionFile as jest.MockedFunction<typeof loadSessionFile>;
const mockSnapshot = snapshotPrefixSession as jest.MockedFunction<
  typeof snapshotPrefixSession
>;

const SESSION_FILE = "file:///docs/session-cache/prefix.bin";
const META_FILE = "file:///docs/session-cache/prefix-meta.json";
const PREFIX = "Sei Vesta...\n\nStrumenti disponibili:\n...";
// What loadSession would detokenize for a GOOD file: template wrapper + prefix.
const GOOD_PROMPT = "<|im_start|>system\n" + PREFIX + "\n\nContesto temporale";

beforeEach(async () => {
  jest.clearAllMocks();
  fs.__files.clear();
  fs.__dirs.clear();
  // Module state (knownDiskHash, debounce clock) persists across tests within
  // the suite — clearPrefixSessionCache resets both.
  await clearPrefixSessionCache();
  jest.useFakeTimers().setSystemTime(new Date(2026, 6, 4, 10, 0, 0));
  mockModelInfo.mockReturnValue({ loaded: true, path: "file:///m/qwen3-4b.gguf" });
  (getKvCacheType as jest.Mock).mockReturnValue("f16");
  // The real snapshot writes the session file as a side effect of saveSession.
  mockSnapshot.mockImplementation(async (opts) => {
    fs.__files.set(opts.path, "KVBIN");
    return 1456;
  });
  mockLoad.mockResolvedValue({ tokensLoaded: 1456, prompt: GOOD_PROMPT });
});

afterEach(() => {
  jest.useRealTimers();
});

// Advance past the persist debounce window.
function pastDebounce() {
  jest.setSystemTime(Date.now() + 180_000);
}

describe("fnv1aHex", () => {
  test("deterministic 8-hex-char digest, sensitive to any input change", () => {
    expect(fnv1aHex("abc")).toBe(fnv1aHex("abc"));
    expect(fnv1aHex("abc")).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1aHex("abc")).not.toBe(fnv1aHex("abd"));
    expect(fnv1aHex("")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("persist → restore round trip", () => {
  test("persists once, then restores on the next launch", async () => {
    const saved = await persistPrefixSession(PREFIX, "[CTX A]\n.", "[CTX B]\n.");
    expect(saved).toBe(1456);
    expect(mockSnapshot).toHaveBeenCalledWith({
      path: SESSION_FILE,
      prefixText: PREFIX,
      probeUserA: "[CTX A]\n.",
      probeUserB: "[CTX B]\n.",
    });
    expect(fs.__files.has(META_FILE)).toBe(true);

    const restored = await restorePrefixSession(PREFIX);
    expect(restored).toBe(1456);
    expect(mockLoad).toHaveBeenCalledWith(SESSION_FILE);
  });

  test("re-persist is skipped while the cache already matches", async () => {
    await persistPrefixSession(PREFIX, "A", "B");
    mockSnapshot.mockClear();
    pastDebounce();

    const second = await persistPrefixSession(PREFIX, "A", "B");
    expect(second).toBeNull();
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  test("restore priming alone (no persist this session) also skips re-persist", async () => {
    await persistPrefixSession(PREFIX, "A", "B");
    // Simulate next launch: module memory of the persist is gone.
    await clearPrefixSessionCacheMemoryOnly();
    await restorePrefixSession(PREFIX);
    mockSnapshot.mockClear();
    pastDebounce();

    expect(await persistPrefixSession(PREFIX, "A", "B")).toBeNull();
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  test("a prefix change (new memory, prompt edit) invalidates and re-persists", async () => {
    await persistPrefixSession(PREFIX, "A", "B");
    mockSnapshot.mockClear();
    pastDebounce();

    const saved = await persistPrefixSession(PREFIX + "\n- new memory", "A", "B");
    expect(saved).toBe(1456);
    expect(mockSnapshot).toHaveBeenCalledTimes(1);
  });

  test("debounce: a second save inside the window is skipped even when stale", async () => {
    await persistPrefixSession(PREFIX, "A", "B");
    mockSnapshot.mockClear();
    // Only 30s later — inside the 120s debounce window.
    jest.setSystemTime(Date.now() + 30_000);

    expect(await persistPrefixSession(PREFIX + " changed", "A", "B")).toBeNull();
    expect(mockSnapshot).not.toHaveBeenCalled();

    pastDebounce();
    expect(await persistPrefixSession(PREFIX + " changed", "A", "B")).toBe(1456);
  });
});

describe("restore staleness and failure paths", () => {
  test("returns null with no cache on disk, without touching the engine", async () => {
    expect(await restorePrefixSession(PREFIX)).toBeNull();
    expect(mockLoad).not.toHaveBeenCalled();
  });

  test("stale prefix hash: skips restore but KEEPS the files for overwrite", async () => {
    await persistPrefixSession(PREFIX, "A", "B");

    expect(await restorePrefixSession(PREFIX + " changed")).toBeNull();
    expect(mockLoad).not.toHaveBeenCalled();
    expect(fs.__files.has(SESSION_FILE)).toBe(true);
  });

  test("different model invalidates the cache", async () => {
    await persistPrefixSession(PREFIX, "A", "B");
    mockModelInfo.mockReturnValue({ loaded: true, path: "file:///m/other.gguf" });

    expect(await restorePrefixSession(PREFIX)).toBeNull();
    expect(mockLoad).not.toHaveBeenCalled();
  });

  test("KV-quant perf toggle invalidates the cache (typed KV cells)", async () => {
    await persistPrefixSession(PREFIX, "A", "B");
    // User enables q8_0 in Settings → reloadActive → f16 file must MISS the
    // hash check, not fail inside llama.cpp's typed state load.
    (getKvCacheType as jest.Mock).mockReturnValue("q8_0");

    expect(await restorePrefixSession(PREFIX)).toBeNull();
    expect(mockLoad).not.toHaveBeenCalled();

    // The next clean turn under q8_0 re-persists.
    pastDebounce();
    expect(await persistPrefixSession(PREFIX, "A", "B")).toBe(1456);
  });

  test("orphaned meta without bin: deleted, and persist is NOT wedged", async () => {
    await persistPrefixSession(PREFIX, "A", "B");
    await clearPrefixSessionCacheMemoryOnly();
    fs.__files.delete(SESSION_FILE); // process died between the two deletes

    expect(await restorePrefixSession(PREFIX)).toBeNull();
    expect(fs.__files.has(META_FILE)).toBe(false);

    // The half-state must not make persist skip forever ("already cached").
    pastDebounce();
    expect(await persistPrefixSession(PREFIX, "A", "B")).toBe(1456);
  });

  test("content mismatch (poisoned file with matching hash): deleted, starts cold", async () => {
    await persistPrefixSession(PREFIX, "A", "B");
    await clearPrefixSessionCacheMemoryOnly();
    mockLoad.mockResolvedValue({
      tokensLoaded: 1456,
      prompt: "<|im_start|>system\nSOMETHING ELSE ENTIRELY",
    });

    expect(await restorePrefixSession(PREFIX)).toBeNull();
    expect(fs.__files.has(SESSION_FILE)).toBe(false);
    expect(fs.__files.has(META_FILE)).toBe(false);
  });

  test("corrupt session file: deletes the cache and starts cold", async () => {
    await persistPrefixSession(PREFIX, "A", "B");
    await clearPrefixSessionCacheMemoryOnly();
    mockLoad.mockRejectedValue(new Error("failed to load session"));

    expect(await restorePrefixSession(PREFIX)).toBeNull();
    expect(fs.__files.has(SESSION_FILE)).toBe(false);
    expect(fs.__files.has(META_FILE)).toBe(false);
  });

  test("engine skipped the load (completion already ran): file kept, persist still skipped", async () => {
    await persistPrefixSession(PREFIX, "A", "B");
    await clearPrefixSessionCacheMemoryOnly();
    mockLoad.mockResolvedValue(null);

    expect(await restorePrefixSession(PREFIX)).toBeNull();
    expect(fs.__files.has(SESSION_FILE)).toBe(true);

    // Disk still holds a matching cache — no pointless re-save.
    mockSnapshot.mockClear();
    pastDebounce();
    expect(await persistPrefixSession(PREFIX, "A", "B")).toBeNull();
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  test("corrupt meta JSON: treated as no cache", async () => {
    await persistPrefixSession(PREFIX, "A", "B");
    await clearPrefixSessionCacheMemoryOnly();
    fs.__files.set(META_FILE, "{not json");

    expect(await restorePrefixSession(PREFIX)).toBeNull();
    expect(mockLoad).not.toHaveBeenCalled();
  });

  test("no model loaded: no-op", async () => {
    mockModelInfo.mockReturnValue({ loaded: false });
    expect(await restorePrefixSession(PREFIX)).toBeNull();
    expect(await persistPrefixSession(PREFIX, "A", "B")).toBeNull();
    expect(mockSnapshot).not.toHaveBeenCalled();
  });
});

describe("persist failure paths", () => {
  test("snapshot error: cleans up, and the NEXT clean turn can retry", async () => {
    mockSnapshot.mockImplementationOnce(async (opts) => {
      fs.__files.set(opts.path, "PARTIAL");
      throw new Error("boundary too short");
    });

    expect(await persistPrefixSession(PREFIX, "A", "B")).toBeNull();
    expect(fs.__files.has(SESSION_FILE)).toBe(false);
    expect(fs.__files.has(META_FILE)).toBe(false);

    // A failed save must not consume the debounce window.
    expect(await persistPrefixSession(PREFIX, "A", "B")).toBe(1456);
  });
});

describe("clearPrefixSessionCache", () => {
  test("wipes both files (dev /session-clear) and re-arms persist", async () => {
    await persistPrefixSession(PREFIX, "A", "B");
    await clearPrefixSessionCache();
    expect(fs.__files.has(SESSION_FILE)).toBe(false);
    expect(fs.__files.has(META_FILE)).toBe(false);

    expect(await persistPrefixSession(PREFIX, "A", "B")).toBe(1456);
  });
});

// "Next launch" simulator: forget the module's in-memory knowledge of the disk
// (knownDiskHash + debounce clock) WITHOUT touching the fake filesystem. The
// production module resets this state only on app restart, so tests reach in
// the same way clearPrefixSessionCache does, minus the file deletion.
async function clearPrefixSessionCacheMemoryOnly(): Promise<void> {
  const savedFiles = new Map(fs.__files);
  await clearPrefixSessionCache();
  for (const [k, v] of savedFiles) fs.__files.set(k, v);
}
