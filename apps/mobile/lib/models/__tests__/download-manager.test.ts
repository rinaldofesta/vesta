// Regression tests for the resumable downloader (Fase 5 bug class E:
// resume/corruption). The commit path guards against truncated files, honors
// pause/resume tokens, and must never commit a partial that a cancel raced —
// none of which was covered. expo-file-system is mocked; ./format runs for real
// (pure, already tested).

import * as FileSystem from "expo-file-system/legacy";
import {
  downloadModel,
  cancelDownload,
  modelPathFor,
  tempPathFor,
} from "../download-manager";

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(async () => {}),
  getFreeDiskStorageAsync: jest.fn(async () => 500 * 1e9),
  createDownloadResumable: jest.fn(),
  moveAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
}));

const mockFS = FileSystem as jest.Mocked<typeof FileSystem>;

const FILE = "model.gguf";
const FINAL = modelPathFor(FILE);
const TEMP = tempPathFor(FINAL);
const MODELS_DIR = "file:///docs/models/";

const flush = () => new Promise((r) => setImmediate(r));

// A fake DownloadResumable; each test overrides the bits it exercises.
function makeTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    downloadAsync: jest.fn(async () => ({ uri: TEMP })),
    resumeAsync: jest.fn(async () => ({ uri: TEMP })),
    pauseAsync: jest.fn(async () => ({ resumeData: "tok" })),
    cancelAsync: jest.fn(async () => {}),
    savable: jest.fn(() => ({ resumeData: "tok" })),
    ...overrides,
  };
}

// Default filesystem: models dir exists, temp file present at `tempSize`, no
// pre-existing final file. Tests tweak tempSize.
function setupFS(tempSize: number) {
  mockFS.getInfoAsync.mockImplementation(async (path: string) => {
    if (path === MODELS_DIR) return { exists: true } as never;
    if (path === TEMP) return { exists: true, size: tempSize } as never;
    return { exists: false } as never; // FINAL, etc.
  });
}

function params(overrides: Record<string, unknown> = {}) {
  return {
    modelId: "m1",
    url: "https://hf/model.gguf",
    fileName: FILE,
    expectedBytes: 1_000_000,
    ...overrides,
  } as Parameters<typeof downloadModel>[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFS.getFreeDiskStorageAsync.mockResolvedValue(500 * 1e9);
});

describe("downloadModel — corruption / size verification", () => {
  it("rejects a truncated file against an authoritative size and deletes the partial", async () => {
    setupFS(500_000); // half of expectedBytes
    mockFS.createDownloadResumable.mockReturnValue(makeTask() as never);

    const outcome = await downloadModel(params({ verifySize: true }));

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/incomplete/i);
    expect(mockFS.deleteAsync).toHaveBeenCalledWith(TEMP, { idempotent: true });
    expect(mockFS.moveAsync).not.toHaveBeenCalled();
  });

  it("commits a complete file by renaming temp → final", async () => {
    setupFS(1_000_000);
    mockFS.createDownloadResumable.mockReturnValue(makeTask() as never);

    const outcome = await downloadModel(params({ verifySize: true }));

    expect(outcome.ok).toBe(true);
    expect(outcome.filePath).toBe(FINAL);
    expect(outcome.sizeBytes).toBe(1_000_000);
    expect(mockFS.moveAsync).toHaveBeenCalledWith({ from: TEMP, to: FINAL });
  });

  it("does NOT reject an under-size file when the size is not authoritative (verifySize=false)", async () => {
    setupFS(10); // catalog approx size can be off; must not fail a complete file
    mockFS.createDownloadResumable.mockReturnValue(makeTask() as never);

    const outcome = await downloadModel(params({ verifySize: false }));

    expect(outcome.ok).toBe(true);
    expect(mockFS.moveAsync).toHaveBeenCalledWith({ from: TEMP, to: FINAL });
  });
});

describe("downloadModel — resume / pause", () => {
  it("resumes via resumeAsync (not downloadAsync) when given a resume token", async () => {
    setupFS(1_000_000);
    const task = makeTask();
    mockFS.createDownloadResumable.mockReturnValue(task as never);

    const outcome = await downloadModel(params({ resumeToken: "tok" }));

    expect(task.resumeAsync).toHaveBeenCalledTimes(1);
    expect(task.downloadAsync).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(true);
  });

  it("on pause keeps the partial and returns the resume token", async () => {
    setupFS(400_000);
    const task = makeTask({ downloadAsync: jest.fn(async () => undefined) });
    mockFS.createDownloadResumable.mockReturnValue(task as never);
    const onResumeToken = jest.fn();

    const outcome = await downloadModel(params({ onResumeToken }));

    expect(outcome).toMatchObject({ ok: false, paused: true, resumeToken: "tok" });
    expect(onResumeToken).toHaveBeenCalledWith("tok");
    // The partial must survive a pause (no delete).
    expect(mockFS.deleteAsync).not.toHaveBeenCalled();
  });
});

describe("downloadModel — cancel races", () => {
  it("a cancel while downloading drops the partial and never commits", async () => {
    setupFS(1_000_000);
    let resolveDownload!: (v: undefined) => void;
    const task = makeTask({
      downloadAsync: jest.fn(() => new Promise((res) => { resolveDownload = res as never; })),
    });
    mockFS.createDownloadResumable.mockReturnValue(task as never);

    // expectedBytes:0 skips the free-space preflight so the task registers fast.
    const promise = downloadModel(params({ expectedBytes: 0 }));
    await flush(); // let downloadModel reach `await task.downloadAsync()`

    await cancelDownload("m1"); // marks the entry canceled
    resolveDownload(undefined); // the resumable resolves undefined on cancel

    const outcome = await promise;
    expect(outcome).toMatchObject({ ok: false, canceled: true });
    expect(task.cancelAsync).toHaveBeenCalled();
    expect(mockFS.deleteAsync).toHaveBeenCalledWith(TEMP, { idempotent: true });
    expect(mockFS.moveAsync).not.toHaveBeenCalled();
  });
});

describe("downloadModel — free-space preflight", () => {
  it("refuses to start when there isn't enough free space", async () => {
    setupFS(0);
    mockFS.getFreeDiskStorageAsync.mockResolvedValue(100); // ~nothing free

    const outcome = await downloadModel(params({ expectedBytes: 5_000_000_000 }));

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/free space/i);
    expect(mockFS.createDownloadResumable).not.toHaveBeenCalled();
  });
});
