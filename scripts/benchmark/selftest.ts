#!/usr/bin/env npx tsx
// Self-checks for the benchmark prompt builder. Run: npx tsx selftest.ts
// Not wired into CI (CI covers apps/mobile only) — run manually after editing
// system-prompt.ts or apps/mobile/lib/orchestrator/prompt-builder.ts, before a
// benchmark run. Guards the two things jest cannot see from apps/mobile: the
// benchmark copy's date math and its side of the SYNC CONTRACT.

import { strict as assert } from "node:assert";
import { buildSystemPrompt, getTomorrow } from "./system-prompt.js";

// 1) LOCAL date math near midnight. The old implementation rendered via
// toISOString() (UTC), which was off by a day near midnight in non-UTC zones.
// With local components the result is host-timezone independent.
assert.equal(getTomorrow("2026-03-08T00:30"), "2026-03-09");
assert.equal(getTomorrow("2026-03-08T23:30"), "2026-03-09");
assert.equal(getTomorrow("2026-12-31T23:59"), "2027-01-01");

// 2) SYNC CONTRACT markers shared with the production prompt builder
// (apps/mobile/lib/orchestrator/__tests__/prompt-builder.test.ts asserts the
// same wording on the mobile side).
const DATETIME = "2026-03-08T14:30"; // minute precision, like production
const it = buildSystemPrompt({ lang: "it", datetime: DATETIME, timezone: "Europe/Rome" });
const en = buildSystemPrompt({ lang: "en", datetime: DATETIME, timezone: "Europe/Rome" });
const MARKERS: Array<[string, string]> = [
  [it, "Contesto temporale corrente:"],
  [it, '"Stanotte" significa'],
  [it, 'formato ISO 8601 "YYYY-MM-DDTHH:MM:SS"'],
  [en, "Current date context:"],
  [en, '"Late tonight" means'],
  [en, 'ISO 8601 format "YYYY-MM-DDTHH:MM:SS"'],
];
for (const [prompt, marker] of MARKERS) {
  assert.ok(prompt.includes(marker), `missing marker: ${marker}`);
}

// 3) The volatile date tail must be the LAST section (KV-cache ordering
// contract), and no stale hardcoded example date may reappear in the rules.
assert.ok(it.trimEnd().endsWith(`Domani è ${getTomorrow(DATETIME)}.`));
assert.ok(en.trimEnd().endsWith(`Tomorrow is ${getTomorrow(DATETIME)}.`));
assert.ok(!it.includes("2026-05-20"));
assert.ok(!en.includes("2026-05-20"));

console.log("selftest OK");
