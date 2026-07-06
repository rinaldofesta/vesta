// Locks the Fase 4 V4 KV-cache invariant: the system prompt is fully STATIC
// (persona + rules + tool schemas + memories/knowledge, nothing time-derived)
// and the date rides in a per-turn [Contesto temporale: ...] line prepended to
// each user message. llama.rn reuses the KV cache only for the longest common
// token prefix across completions, so any time-derived content in the system
// prompt would sit between the cached prefix and the conversation history and
// silently re-prefill the whole history on every clock tick.
// tool-registry runs for real, so the schemas the invariant protects are the
// production ones.

import {
  buildStablePrefix,
  buildTurnContext,
  annotateUserMessage,
  TIME_CONTEXT_MARKER,
} from "../prompt-builder";
import { localDateStr, addDays } from "../date-utils";
import type { Language } from "../types";

const LANGS: Language[] = ["it", "en"];
const TOOLS_MARKER: Record<Language, string> = {
  it: "Strumenti disponibili:",
  en: "Available tools:",
};

afterEach(() => {
  jest.useRealTimers();
});

describe.each(LANGS)("prompt-builder V4 KV-cache invariant (%s)", (lang) => {
  test("system prompt is byte-identical across clock changes", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 1, 22, 41, 37));
    const promptA = buildStablePrefix(lang, "- (fact) loves espresso", "notes");

    // Different year, month, day, hour, minute, second — so even year- or
    // month-derived interpolation trips byte-equality.
    jest.setSystemTime(new Date(2027, 1, 3, 5, 7, 9));
    const promptB = buildStablePrefix(lang, "- (fact) loves espresso", "notes");

    expect(promptB).toBe(promptA);
  });

  test("no time-derived content leaks into the system prompt", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 1, 22, 41, 0));
    const now = new Date();
    const prompt = buildStablePrefix(lang, "- (fact) loves espresso", "notes");
    expect(prompt).not.toContain(localDateStr(now)); // today
    expect(prompt).not.toContain(localDateStr(addDays(now, 1))); // tomorrow
    expect(prompt).not.toContain("22:41"); // current time
    // No concrete calendar date AT ALL — neither live (volatile) nor
    // hardcoded (goes stale, and small models copy prompt examples).
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("ordering: rules reference the time context, then tools, then memories/knowledge", () => {
    const prompt = buildStablePrefix(lang, "MEMORY_MARKER", "KNOWLEDGE_MARKER");
    const ruleIdx = prompt.indexOf(TIME_CONTEXT_MARKER[lang]);
    const toolsIdx = prompt.indexOf(TOOLS_MARKER[lang]);
    const memIdx = prompt.indexOf("MEMORY_MARKER");
    const knowIdx = prompt.indexOf("KNOWLEDGE_MARKER");

    expect(ruleIdx).toBeGreaterThan(-1); // the rules explain the annotation
    expect(toolsIdx).toBeGreaterThan(ruleIdx);
    expect(memIdx).toBeGreaterThan(toolsIdx);
    expect(knowIdx).toBeGreaterThan(memIdx);
  });

  test("turn context is a pure function of (lang, at) with minute precision", () => {
    const at = new Date(2026, 6, 1, 22, 41, 37);
    const ctx = buildTurnContext(lang, at);
    // Deterministic given the instant — no wall-clock dependency.
    expect(ctx).toBe(buildTurnContext(lang, at));
    // Seconds omitted: turns in the same minute render identical bytes.
    expect(ctx).toContain("2026-07-01T22:41");
    expect(ctx).not.toContain("22:41:37");
    expect(ctx).toBe(buildTurnContext(lang, new Date(2026, 6, 1, 22, 41, 59)));
    // Different instants must produce different contexts (this divergence is
    // what the session-cache boundary probe relies on).
    expect(buildTurnContext(lang, new Date(2020, 0, 2, 3, 4))).not.toBe(ctx);
    // Single line wrapped in the marker brackets.
    expect(ctx.startsWith(TIME_CONTEXT_MARKER[lang])).toBe(true);
    expect(ctx.endsWith("]")).toBe(true);
    expect(ctx).not.toContain("\n");
  });

  test("annotated user message: context on the first line, text after", () => {
    const at = new Date(2026, 6, 1, 22, 41, 0);
    const annotated = annotateUserMessage(lang, at, "svegliami alle 7");
    expect(annotated).toBe(`${buildTurnContext(lang, at)}\nsvegliami alle 7`);
  });
});

describe("prompt content guards", () => {
  test("turn context carries LOCAL today/tomorrow/weekday near midnight", () => {
    const ctx = buildTurnContext("it", new Date(2026, 6, 1, 23, 59, 0));
    expect(ctx).toContain("mercoledì 2026-07-01T23:59");
    expect(ctx).toContain("Oggi: 2026-07-01");
    expect(ctx).toContain("Domani: 2026-07-02");
    const ctxEn = buildTurnContext("en", new Date(2026, 6, 1, 23, 59, 0));
    expect(ctxEn).toContain("Wednesday 2026-07-01T23:59");
    expect(ctxEn).toContain("Tomorrow: 2026-07-02");
  });

  test("rules explain the annotation and point at the MOST RECENT message", () => {
    expect(buildStablePrefix("it")).toContain("[Contesto temporale: ...]");
    expect(buildStablePrefix("it")).toContain("PIÙ RECENTE");
    expect(buildStablePrefix("en")).toContain("[Time context: ...]");
    expect(buildStablePrefix("en")).toContain("MOST RECENT");
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
});
