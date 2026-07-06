// Formal before/after prefill benchmark (Fase 4), dev-only.
//
// Measures llama.rn `timings.promptMs` across a scripted multi-turn
// conversation under the three prompt layouts:
//   V2 "date-first"     — frozen pre-PR-#18 builder (lib/dev/prompt-v2.ts):
//                         volatile datetime above the tool schemas.
//   V3 "stable-prefix"  — frozen PR-#18..#20 builder (lib/dev/prompt-v3.ts):
//                         volatile date tail at the end of the system prompt,
//                         BETWEEN the cached prefix and the history.
//   V4 "per-turn date"  — current builder: fully static system prompt, the
//                         date rides in each user message and history replays
//                         byte-identically.
//
// All arms see the same user texts and (canned) assistant history; the
// injected clock advances 70s per turn so EVERY turn crosses a minute
// boundary — the worst case for KV-cache reuse and the normal case in real
// usage. The KV cache is cleared before each arm, so turn 1 is a cold prefill
// in all three. Arms run oldest-first: if the device thermally throttles over
// the run, the penalty lands on the newest layout, biasing AGAINST the claim.
//
// Expected shape: V2 re-prefills everything every turn; V3 re-prefills the
// history below the date tail (cost grows with history); V4 prefills only the
// new user message (flat, small).
//
// Run from the chat input in a dev build: /benchmark-prefill

import { clearKvCache, generate, getModelInfo, isLoaded } from "../llm/llm-engine";
import type { CompletionMessage } from "../llm/llm-engine";
import { cancelExtraction } from "../orchestrator/memory-manager";
import {
  buildStablePrefix,
  annotateUserMessage,
} from "../orchestrator/prompt-builder";
import { buildSystemPromptV2 } from "./prompt-v2";
import { buildStablePrefixV3, buildVolatileTailV3 } from "./prompt-v3";
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

function turnDate(i: number): Date {
  return new Date(START.getTime() + i * STEP_MS);
}

// Full message list for turn `turnIdx` of an arm. `system` renders from the
// CURRENT turn's clock (V2/V3 interpolate it; V4 ignores it), `user` renders
// each user message from ITS OWN turn's clock — V4's byte-stable replay is
// exactly this property.
function messagesFor(
  system: (now: Date) => string,
  user: (text: string, at: Date) => string,
  turnIdx: number,
): CompletionMessage[] {
  const messages: CompletionMessage[] = [
    { role: "system", content: system(turnDate(turnIdx)) },
  ];
  for (let j = 0; j < turnIdx; j++) {
    messages.push(
      { role: "user", content: user(TURNS[j].user, turnDate(j)) },
      { role: "assistant", content: TURNS[j].canned },
    );
  }
  messages.push({
    role: "user",
    content: user(TURNS[turnIdx].user, turnDate(turnIdx)),
  });
  return messages;
}

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
  system: (now: Date) => string,
  user: (text: string, at: Date) => string,
  onProgress: (line: string) => void,
): Promise<ArmResult> {
  await clearKvCache();
  const turns: TurnResult[] = [];

  for (let i = 0; i < TURNS.length; i++) {
    // Tiny n_predict: decode time is irrelevant here, prefill is the metric.
    const result = await generate(messagesFor(system, user, i), {
      maxTokens: 8,
      temperature: 0,
    });
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
 * Run all three arms and return a markdown report. Progress lines stream
 * through `onProgress` (the chat store shows them as streaming text).
 */
export async function runPrefillBenchmark(
  onProgress: (line: string) => void,
): Promise<string> {
  if (!isLoaded()) throw new Error("No model loaded");
  // A background memory extraction from the previous turn may still hold the
  // engine lock for up to 30s — cancel it so the first arm starts immediately.
  cancelExtraction();
  const modelName = getModelInfo().path?.split("/").pop() ?? "?";

  const plainUser = (text: string) => text;

  onProgress("Braccio 1/3: V2 (data in testa)...");
  const v2 = await runArm(
    "V2",
    (now) => buildSystemPromptV2(LANG, now),
    plainUser,
    onProgress,
  );

  onProgress("Braccio 2/3: V3 (prefisso stabile + coda data)...");
  const stablePrefixV3 = buildStablePrefixV3(LANG);
  const v3 = await runArm(
    "V3",
    (now) => stablePrefixV3 + buildVolatileTailV3(LANG, now),
    plainUser,
    onProgress,
  );

  onProgress("Braccio 3/3: V4 (data per turno)...");
  const staticSystem = buildStablePrefix(LANG);
  const v4 = await runArm(
    "V4",
    () => staticSystem,
    (text, at) => annotateUserMessage(LANG, at, text),
    onProgress,
  );

  // Turn 1 is the cold prefill in every arm; the caching claims are about the
  // warm turns (2+): V2 re-prefills everything, V3 re-prefills the history
  // below the date tail, V4 appends.
  const warm = (a: ArmResult) => mean(a.turns.slice(1).map((t) => t.promptMs));
  const [warmV2, warmV3, warmV4] = [warm(v2), warm(v3), warm(v4)];

  return [
    "Benchmark prefill (timings.promptMs)",
    `Modello: ${modelName}`,
    `${TURNS.length} turni per braccio, clock +70s/turno, storia identica`,
    "",
    "V2 — data in testa (pre PR #18):",
    formatArm(v2),
    "",
    "V3 — prefisso stabile + coda data (PR #18..#20):",
    formatArm(v3),
    "",
    "V4 — data per turno (attuale):",
    formatArm(v4),
    "",
    `Turno 1 (cold): V2 ${Math.round(v2.turns[0].promptMs)} ms, V3 ${Math.round(v3.turns[0].promptMs)} ms, V4 ${Math.round(v4.turns[0].promptMs)} ms`,
    `Media turni 2-${TURNS.length} (warm): V2 ${Math.round(warmV2)} ms, V3 ${Math.round(warmV3)} ms, V4 ${Math.round(warmV4)} ms`,
    `V4 vs V3 (warm): ${(warmV3 / warmV4).toFixed(1)}x — V4 ultimo turno ${Math.round(v4.turns[TURNS.length - 1].promptMs)} ms vs V3 ${Math.round(v3.turns[TURNS.length - 1].promptMs)} ms`,
  ].join("\n");
}
