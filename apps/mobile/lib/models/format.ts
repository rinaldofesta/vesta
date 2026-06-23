// Pure, dependency-free helpers for the model manager. Kept separate so they
// are trivially unit-testable (no native modules, no I/O).

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb < 10 ? 2 : 1)} GB`;
}

// "1m 23s", "45s", "2h 5m". Returns "—" for unknown/non-finite.
export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM ? `${h}h ${remM}m` : `${h}h`;
}

// Bytes/sec from two timestamped samples. Returns 0 if the interval is
// non-positive (guards against divide-by-zero and clock glitches).
export function computeRate(
  prevBytes: number,
  prevMs: number,
  curBytes: number,
  curMs: number,
): number {
  const dt = (curMs - prevMs) / 1000;
  if (dt <= 0) return 0;
  const db = curBytes - prevBytes;
  return db > 0 ? db / dt : 0;
}

// Seconds remaining given bytes left and a rate. null when rate is 0/unknown.
export function etaSeconds(
  bytesWritten: number,
  bytesTotal: number,
  bytesPerSec: number,
): number | null {
  if (bytesPerSec <= 0 || bytesTotal <= 0) return null;
  const remaining = Math.max(0, bytesTotal - bytesWritten);
  return remaining / bytesPerSec;
}

// Free-space preflight: require the model size plus headroom (KV cache, the
// `.download` temp coexisting with the final file during the rename, etc.).
export function hasEnoughSpace(
  freeBytes: number,
  sizeBytes: number,
  headroom = 1.1,
): boolean {
  if (sizeBytes <= 0) return true; // unknown size — let the download proceed
  return freeBytes >= sizeBytes * headroom;
}

// RAM fit. totalRamMb may be null (unknown) — in that case we don't block,
// we only label, so this returns "unknown" rather than a hard verdict.
export function ramFit(
  minRamMb: number | null,
  totalRamMb: number | null,
): "ok" | "tight" | "insufficient" | "unknown" {
  if (totalRamMb == null || minRamMb == null) return "unknown";
  if (totalRamMb >= minRamMb * 1.5) return "ok";
  if (totalRamMb >= minRamMb) return "tight";
  return "insufficient";
}

export function percent(written: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (written / total) * 100));
}
