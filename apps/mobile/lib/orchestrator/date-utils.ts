// Pure date helpers, dependency-free and unit-tested.
//
// The system prompt must give the model LOCAL today/tomorrow. Using
// toISOString() (UTC) made "tomorrow" off by a day near midnight in non-UTC
// zones — a real bug for an alarm/calendar assistant.

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

// YYYY-MM-DD from the date's LOCAL components (not UTC).
export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

// Strict YYYY-MM-DD validation that rejects impossible days (e.g. 2026-02-30),
// which `new Date(v)` would silently roll over to the next month.
export function isValidYMD(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
