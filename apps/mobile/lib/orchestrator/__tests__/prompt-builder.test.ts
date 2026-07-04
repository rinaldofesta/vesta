// Locks the Fase 4 KV-cache invariant: the system prompt is a STABLE PREFIX
// (persona + rules + tool schemas + memories/knowledge) followed by a VOLATILE
// TAIL (date context). llama.rn reuses the KV cache only for the longest
// common token prefix across completions, so any time-derived content leaking
// above the tail silently re-pays the full ~17s schema prefill on device.
// tool-registry runs for real, so the schemas the invariant protects are the
// production ones.

import {
  buildStablePrefix,
  buildVolatileTail,
  buildSystemPrompt,
} from "../prompt-builder";
import { localDateStr, addDays } from "../date-utils";
import type { Language } from "../types";

const LANGS: Language[] = ["it", "en"];
const TAIL_MARKER: Record<Language, string> = {
  it: "Contesto temporale corrente:",
  en: "Current date context:",
};
const TOOLS_MARKER: Record<Language, string> = {
  it: "Strumenti disponibili:",
  en: "Available tools:",
};

afterEach(() => {
  jest.useRealTimers();
});

describe.each(LANGS)("prompt-builder KV-cache invariant (%s)", (lang) => {
  test("stable prefix is byte-identical across clock changes", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 1, 22, 41, 37));
    const stableA = buildStablePrefix(lang, "- (fact) loves espresso", "notes");
    const promptA = buildSystemPrompt(lang, "- (fact) loves espresso", "notes");
    const tailA = buildVolatileTail(lang);

    // Full prompt = stable prefix + volatile tail, EXACTLY: nothing may sit
    // between them or after the tail, or it would re-prefill every turn.
    expect(promptA).toBe(stableA + tailA);

    // Different year, month, day, hour, minute, second — so even year- or
    // month-derived interpolation into the prefix trips byte-equality.
    jest.setSystemTime(new Date(2027, 1, 3, 5, 7, 9));
    const stableB = buildStablePrefix(lang, "- (fact) loves espresso", "notes");
    const promptB = buildSystemPrompt(lang, "- (fact) loves espresso", "notes");

    expect(stableB).toBe(stableA);
    expect(promptB).toBe(stableA + buildVolatileTail(lang));
    expect(promptA).not.toBe(promptB);
  });

  test("no time-derived content leaks into the stable prefix", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 1, 22, 41, 0));
    const now = new Date();
    const stable = buildStablePrefix(lang, "- (fact) loves espresso", "notes");
    expect(stable).not.toContain(localDateStr(now)); // today
    expect(stable).not.toContain(localDateStr(addDays(now, 1))); // tomorrow
    expect(stable).not.toContain("22:41"); // current time
    // No concrete calendar date AT ALL in the prefix — neither live (volatile)
    // nor hardcoded (goes stale, and small models copy prompt examples).
    expect(stable).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("ordering: tools, then memories/knowledge, then the volatile tail last", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 1, 22, 41, 37));
    const prompt = buildSystemPrompt(lang, "MEMORY_MARKER", "KNOWLEDGE_MARKER");
    const toolsIdx = prompt.indexOf(TOOLS_MARKER[lang]);
    const memIdx = prompt.indexOf("MEMORY_MARKER");
    const knowIdx = prompt.indexOf("KNOWLEDGE_MARKER");
    const tailIdx = prompt.indexOf(TAIL_MARKER[lang]);

    expect(toolsIdx).toBeGreaterThan(-1);
    expect(memIdx).toBeGreaterThan(toolsIdx);
    expect(knowIdx).toBeGreaterThan(memIdx);
    // Memories/knowledge are semi-stable (change rarely) — they extend the
    // cached prefix, so they must sit BEFORE the every-turn date tail.
    expect(tailIdx).toBeGreaterThan(knowIdx);
    expect(prompt.indexOf(TAIL_MARKER[lang], tailIdx + 1)).toBe(-1);
  });

  test("datetime has minute precision (seconds would defeat same-minute reuse)", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 1, 22, 41, 37));
    const tail = buildVolatileTail(lang);
    expect(tail).toContain("2026-07-01T22:41 (");
    expect(tail).not.toContain("22:41:37");
  });
});

describe("prompt content guards", () => {
  test("volatile tail carries the real LOCAL today/tomorrow near midnight", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 1, 23, 59, 0));
    const tail = buildVolatileTail("it");
    expect(tail).toContain("Oggi è mercoledì, 2026-07-01");
    expect(tail).toContain("Domani è 2026-07-02");
  });

  test("late-night terms are quoted in both languages", () => {
    expect(buildStablePrefix("it")).toContain('"Stanotte" significa');
    expect(buildStablePrefix("en")).toContain('"Late tonight" means');
  });

  test("no stale hardcoded example date in the rules", () => {
    for (const lang of LANGS) {
      expect(buildStablePrefix(lang)).not.toContain("2026-05-20");
      expect(buildStablePrefix(lang)).toContain("YYYY-MM-DDTHH:MM:SS");
    }
  });

  test("volatile tail accepts an injected instant (session-cache probes, dev benchmark)", () => {
    // Deterministic given the instant — no dependency on the wall clock.
    const at = new Date(2026, 6, 4, 9, 15, 42);
    const tail = buildVolatileTail("it", at);
    expect(tail).toBe(buildVolatileTail("it", at));
    expect(tail).toContain("2026-07-04T09:15 (");
    expect(tail).toContain("Domani è 2026-07-05");

    // Two different instants must produce different tails (this divergence is
    // exactly what snapshotPrefixSession's boundary probe relies on).
    expect(buildVolatileTail("it", new Date(2020, 0, 2, 3, 4))).not.toBe(tail);

    // Omitting the argument still reads the real clock (production path).
    jest.useFakeTimers().setSystemTime(at);
    expect(buildVolatileTail("it")).toBe(tail);
  });
});
