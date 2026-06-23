import { treeUrl, resolveUrl, parseGgufTree } from "../hf-client";

describe("treeUrl", () => {
  it("builds the recursive tree endpoint", () => {
    expect(treeUrl("Qwen/Qwen3-4B-GGUF")).toBe(
      "https://huggingface.co/api/models/Qwen/Qwen3-4B-GGUF/tree/main?recursive=1",
    );
  });
});

describe("resolveUrl", () => {
  it("builds a resolve URL with download flag", () => {
    expect(resolveUrl("Qwen/Qwen3-4B-GGUF", "Qwen3-4B-Q4_K_M.gguf")).toBe(
      "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf?download=true",
    );
  });
  it("encodes segments but preserves directory separators", () => {
    expect(resolveUrl("org/repo", "sub dir/file name.gguf")).toBe(
      "https://huggingface.co/org/repo/resolve/main/sub%20dir/file%20name.gguf?download=true",
    );
  });
});

describe("parseGgufTree", () => {
  it("keeps only .gguf files and reads size + sha", () => {
    const tree = [
      { type: "directory", path: "subdir" },
      { type: "file", path: "README.md", size: 100 },
      {
        type: "file",
        path: "model-Q4_K_M.gguf",
        size: 2500,
        lfs: { oid: "abc123", size: 2500, pointerSize: 130 },
      },
      { type: "file", path: "model-Q8_0.gguf", lfs: { oid: "def456", size: 9000 } },
    ];
    const files = parseGgufTree(tree);
    expect(files.map((f) => f.path)).toEqual([
      "model-Q4_K_M.gguf",
      "model-Q8_0.gguf",
    ]);
    expect(files[0]).toEqual({ path: "model-Q4_K_M.gguf", sizeBytes: 2500, sha256: "abc123" });
    // size falls back to lfs.size when top-level size absent
    expect(files[1]).toEqual({ path: "model-Q8_0.gguf", sizeBytes: 9000, sha256: "def456" });
  });
  it("returns [] for non-array / malformed input", () => {
    expect(parseGgufTree(null)).toEqual([]);
    expect(parseGgufTree({} as unknown)).toEqual([]);
    expect(parseGgufTree([{ path: 123 }, "nope", null])).toEqual([]);
  });
  it("is case-insensitive on the extension", () => {
    expect(parseGgufTree([{ type: "file", path: "M.GGUF", size: 1 }])).toHaveLength(1);
  });
});
