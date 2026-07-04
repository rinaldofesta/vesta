// Formal before/after prefill benchmark (Fase 4), dev-only.
//
// Measures llama.rn `timings.promptMs` across a scripted multi-turn
// conversation under the two prompt layouts:
//   V2 "date-first"     — frozen pre-PR-#18 builder (lib/dev/prompt-v2.ts):
//                         volatile datetime above the tool schemas.
//   V3 "stable-prefix"  — current builder: datetime-only tail at the end.
//
// Both arms see byte-identical user messages and (canned) assistant history;
// the injected clock advances 70s per turn so EVERY turn crosses a minute
// boundary — the worst case for KV-cache reuse and the normal case in real
// usage. The KV cache is cleared before each arm, so turn 1 is a cold prefill
// in both (a built-in sanity check: the two colds should be roughly equal).
// V2 runs first: if the device thermally throttles over the run, the penalty
// lands on V3, which biases the result AGAINST the restructure.
//
// Run from the chat input in a dev build: /benchmark-prefill

import { clearKvCache, generate, getModelInfo, isLoaded } from "../llm/llm-engine";
import type { CompletionMessage } from "../llm/llm-engine";
import { cancelExtraction } from "../orchestrator/memory-manager";
import {
  buildStablePrefix,
  buildVolatileTail,
} from "../orchestrator/prompt-builder";
import { buildSystemPromptV2 } from "./prompt-v2";
import type { Language } from "../orchestrator/types";

const LANG: Language = "it";
// Fixed start instant so the run is independent of the device clock.
const START = new Date(2026, 6, 4, 9, 15, 0);
const STEP_MS = 70_000;

// Plain-chat turns (no tool routing): the measurement target is prefill, and
// canned assistant replies keep the history byte-identical across arms.
const TURNS: Array<{ user: string; canned: string }> = [
  { user: "ciao, come va?", canned: "Tutto bene! Come posso aiutarti?" },
  { user: "che ora è adesso?", canned: "Sono le 9:16." },
  {
    user: "raccontami una curiosità sulla Sicilia",
    canned: "L'Etna è il vulcano attivo più alto d'Europa.",
  },
  { user: "quanto fa 12 per 8?", canned: "Fa 96." },
  {
    user: "consigliami un libro",
    canned: "Ti consiglio Il Gattopardo di Tomasi di Lampedusa.",
  },
  { user: "grazie mille", canned: "Prego! A disposizione." },
];

interface TurnResult {
  promptMs: number;
  tokensEvaluated: number;
}

interface ArmResult {
  name: string;
  turns: TurnResult[];
}

async function runArm(
  name: string,
  buildPrompt: (now: Date) => string,
  onProgress: (line: string) => void,
): Promise<ArmResult> {
  await clearKvCache();
  const history: CompletionMessage[] = [];
  const turns: TurnResult[] = [];

  for (let i = 0; i < TURNS.length; i++) {
    const now = new Date(START.getTime() + i * STEP_MS);
    const messages: CompletionMessage[] = [
      { role: "system", content: buildPrompt(now) },
      ...history,
      { role: "user", content: TURNS[i].user },
    ];
    // Tiny n_predict: decode time is irrelevant here, prefill is the metric.
    const result = await generate(messages, { maxTokens: 8, temperature: 0 });
    // The Stop button is live during the run (isGenerating is set). A stop
    // mid-prefill leaves this turn partially measured and would silently
    // inflate the next one — abort the whole run instead of reporting junk.
    if (result.stoppedByUser) {
      throw new Error(`Benchmark interrotto (Stop) al braccio ${name}, turno ${i + 1}`);
    }
    turns.push({
      promptMs: result.timings.promptMs,
      tokensEvaluated: result.tokensEvaluated,
    });
    onProgress(
      `${name} turno ${i + 1}/${TURNS.length}: ${Math.round(result.timings.promptMs)} ms (${result.tokensEvaluated} tok prefilled)`,
    );
    history.push(
      { role: "user", content: TURNS[i].user },
      { role: "assistant", content: TURNS[i].canned },
    );
  }
  return { name, turns };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function formatArm(arm: ArmResult): string {
  return arm.turns
    .map(
      (t, i) =>
        `  turno ${i + 1}: ${String(Math.round(t.promptMs)).padStart(6)} ms  (${t.tokensEvaluated} tok)`,
    )
    .join("\n");
}

/**
 * Run both arms and return a markdown report. Progress lines stream through
 * `onProgress` (the chat store shows them as streaming text).
 */
export async function runPrefillBenchmark(
  onProgress: (line: string) => void,
): Promise<string> {
  if (!isLoaded()) throw new Error("No model loaded");
  // A background memory extraction from the previous turn may still hold the
  // engine lock for up to 30s — cancel it so the first arm starts immediately.
  cancelExtraction();
  const modelName = getModelInfo().path?.split("/").pop() ?? "?";

  onProgress("Braccio 1/2: V2 (data in testa)...");
  const v2 = await runArm("V2", (now) => buildSystemPromptV2(LANG, now), onProgress);

  onProgress("Braccio 2/2: V3 (prefisso stabile)...");
  const stablePrefix = buildStablePrefix(LANG);
  const v3 = await runArm(
    "V3",
    (now) => stablePrefix + buildVolatileTail(LANG, now),
    onProgress,
  );

  // Turn 1 is the cold prefill in both arms; the caching claim is about the
  // warm turns (2+), where V2 keeps re-prefilling everything below the date.
  const warmV2 = mean(v2.turns.slice(1).map((t) => t.promptMs));
  const warmV3 = mean(v3.turns.slice(1).map((t) => t.promptMs));
  const speedup = warmV3 > 0 ? warmV2 / warmV3 : NaN;

  return [
    "Benchmark prefill (timings.promptMs)",
    `Modello: ${modelName}`,
    `${TURNS.length} turni per braccio, clock +70s/turno, storia identica`,
    "",
    "V2 — data in testa (pre PR #18):",
    formatArm(v2),
    "",
    "V3 — prefisso stabile (attuale):",
    formatArm(v3),
    "",
    `Turno 1 (cold, sanity check): V2 ${Math.round(v2.turns[0].promptMs)} ms vs V3 ${Math.round(v3.turns[0].promptMs)} ms`,
    `Media turni 2-${TURNS.length} (warm): V2 ${Math.round(warmV2)} ms vs V3 ${Math.round(warmV3)} ms → ${speedup.toFixed(1)}x`,
  ].join("\n");
}
