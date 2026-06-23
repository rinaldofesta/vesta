// Minimal HuggingFace Hub client — the ONLY network egress in Vesta, and only
// ever called on an explicit user action (browsing a repo or starting a
// download). No telemetry, no prefetch, no background calls.
//
// URL builders and the tree parser are pure (unit-tested); the two functions
// that actually hit the network are thin wrappers around fetch().

const HF = "https://huggingface.co";

export interface HfFile {
  path: string;
  sizeBytes: number;
  sha256: string | null; // LFS oid, when present
}

export function treeUrl(repo: string): string {
  return `${HF}/api/models/${repo}/tree/main?recursive=1`;
}

export function resolveUrl(repo: string, file: string): string {
  // Encode each path segment but preserve directory separators.
  const encoded = file.split("/").map(encodeURIComponent).join("/");
  return `${HF}/${repo}/resolve/main/${encoded}?download=true`;
}

// Pure: turn a raw HF tree response into the list of downloadable GGUF files.
// The tree API returns objects like:
//   { type, path, size, oid, lfs?: { oid, size, pointerSize } }
// For LFS-backed GGUFs the real byte size lives in `size` (or `lfs.size`) and
// the sha256 is `lfs.oid`.
export function parseGgufTree(entries: unknown): HfFile[] {
  if (!Array.isArray(entries)) return [];
  const files: HfFile[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const obj = e as Record<string, unknown>;
    if (obj.type === "directory") continue;
    const path = typeof obj.path === "string" ? obj.path : null;
    if (!path || !path.toLowerCase().endsWith(".gguf")) continue;
    const lfs = (obj.lfs as Record<string, unknown> | undefined) ?? undefined;
    const sizeBytes =
      typeof obj.size === "number"
        ? obj.size
        : typeof lfs?.size === "number"
          ? (lfs.size as number)
          : 0;
    const sha256 = typeof lfs?.oid === "string" ? (lfs.oid as string) : null;
    files.push({ path, sizeBytes, sha256 });
  }
  // Largest first is a poor default for quants; sort by path for stability.
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

// Network: list the .gguf files in a public repo. Throws on network/HTTP error
// so callers can show a precise message (gated repos surface as 401/403).
export async function listGgufFiles(repo: string): Promise<HfFile[]> {
  const res = await fetch(treeUrl(repo), {
    headers: { Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    const err = new Error("GATED") as Error & { code?: string };
    err.code = "GATED";
    throw err;
  }
  if (!res.ok) {
    throw new Error(`HuggingFace returned HTTP ${res.status} for ${repo}`);
  }
  const json = (await res.json()) as unknown;
  return parseGgufTree(json);
}

export interface AccessResult {
  ok: boolean;
  status: number;
  gated: boolean;
}

// Network: HEAD probe to decide anonymous-vs-gated before downloading.
export async function checkAccess(url: string): Promise<AccessResult> {
  const res = await fetch(url, { method: "HEAD" });
  return {
    ok: res.ok,
    status: res.status,
    gated: res.status === 401 || res.status === 403,
  };
}
