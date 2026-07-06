#!/usr/bin/env npx tsx
// Self-checks for the benchmark prompt builder. Run: npx tsx selftest.ts
// Not wired into CI (CI covers apps/mobile only) — run manually after editing
// system-prompt.ts or apps/mobile/lib/orchestrator/prompt-builder.ts, before a
// benchmark run. Guards the things jest cannot see from apps/mobile: the
// benchmark copy's date math and its side of the SYNC CONTRACT.

import { strict as assert } from "node:assert";
import {
  buildSystemPrompt,
  buildTurnContext,
  annotateUserMessage,
  getTomorrow,
} from "./system-prompt.js";

// 1) LOCAL date math near midnight. The old implementation rendered via
// toISOString() (UTC), which was off by a day near midnight in non-UTC zones.
// With local components the result is host-timezone independent.
assert.equal(getTomorrow("2026-03-08T00:30"), "2026-03-09");
assert.equal(getTomorrow("2026-03-08T23:30"), "2026-03-09");
assert.equal(getTomorrow("2026-12-31T23:59"), "2027-01-01");

// 2) SYNC CONTRACT markers shared with the production prompt builder
// (apps/mobile/lib/orchestrator/__tests__/prompt-builder.test.ts asserts the
// same wording on the mobile side).
const it = buildSystemPrompt("it");
const en = buildSystemPrompt("en");
const MARKERS: Array<[string, string]> = [
  [it, "[Contesto temporale: ...]"],
  [it, '"Stanotte" significa'],
  [it, 'formato ISO 8601 "YYYY-MM-DDTHH:MM:SS"'],
  [en, "[Time context: ...]"],
  [en, '"Late tonight" means'],
  [en, 'ISO 8601 format "YYYY-MM-DDTHH:MM:SS"'],
];
for (const [prompt, marker] of MARKERS) {
  assert.ok(prompt.includes(marker), `missing marker: ${marker}`);
}

// 3) The system prompt must be fully STATIC (V4): no concrete calendar date
// anywhere — neither live (would re-prefill history every clock tick on
// device) nor a stale hardcoded example.
assert.ok(!/\d{4}-\d{2}-\d{2}/.test(it), "date leaked into IT system prompt");
assert.ok(!/\d{4}-\d{2}-\d{2}/.test(en), "date leaked into EN system prompt");

// 4) The per-turn time context carries datetime, weekday, today and tomorrow,
// and the annotated user message puts it on the FIRST line.
const PARAMS = { lang: "it" as const, datetime: "2026-03-08T14:30", timezone: "Europe/Rome" };
const ctx = buildTurnContext(PARAMS);
assert.ok(ctx.startsWith("[Contesto temporale: domenica 2026-03-08T14:30 (Europe/Rome)"));
assert.ok(ctx.includes("Oggi: 2026-03-08"));
assert.ok(ctx.includes("Domani: 2026-03-09"));
const annotated = annotateUserMessage(PARAMS, "svegliami alle 7");
assert.equal(annotated, `${ctx}\nsvegliami alle 7`);
const ctxEn = buildTurnContext({ ...PARAMS, lang: "en" });
assert.ok(ctxEn.startsWith("[Time context: Sunday 2026-03-08T14:30 (Europe/Rome)"));

console.log("selftest OK");
