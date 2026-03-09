#!/usr/bin/env npx tsx
// Fase 0 Benchmark Runner
// Reads prompts.jsonl, sends each to Ollama, evaluates tool accuracy.
// Usage: npx tsx run.ts [model-name] [--mock] [--no-think]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildSystemPrompt } from "./system-prompt.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Prompt {
  id: string;
  input: string;
  expected_tool: string;
  expected_params: Record<string, unknown>;
  lang: "it" | "en";
  difficulty: "easy" | "medium" | "ambiguous";
}

interface BenchmarkResult {
  id: string;
  input: string;
  lang: string;
  difficulty: string;
  json_valid: boolean;
  tool_correct: boolean;
  params_correct: boolean;
  latency_ms: number;
  raw_response: string;
  error: string;
}

interface ParsedResponse {
  tool: string;
  parameters: Record<string, unknown>;
  message?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_FILE = join(__dirname, "prompts.jsonl");
const RESULTS_DIR = join(__dirname, "results");
const OLLAMA_URL = "http://localhost:11434";

// Current datetime for system prompt (simulating "now" for benchmark)
const CURRENT_DATETIME = "2026-03-08T14:30:00";
const TIMEZONE = "Europe/Rome";

// ---------------------------------------------------------------------------
// Ollama API
// ---------------------------------------------------------------------------

// Whether to disable thinking mode (set via --no-think flag)
let noThink = false;

async function queryOllama(
  model: string,
  systemPrompt: string,
  userMessage: string
): Promise<{ response: string; latencyMs: number }> {
  const start = Date.now();

  // When --no-think is set, append /no_think to the user message.
  // This tells Qwen3 to produce shorter chain-of-thought. Thinking tokens
  // still count against num_predict, so we use 2048 (vs 4096 for full think).
  const message = noThink ? userMessage + " /no_think" : userMessage;
  const maxTokens = noThink ? 2048 : 4096;

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: maxTokens,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string };
  };
  const latencyMs = Date.now() - start;
  let response = data.message?.content ?? "";

  // Strip inline <think>...</think> blocks and orphan </think> tags.
  // With think:false, some models still emit chain-of-thought inline
  // followed by a </think> tag before the actual response.
  response = response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const thinkEnd = response.lastIndexOf("</think>");
  if (thinkEnd !== -1) {
    response = response.substring(thinkEnd + "</think>".length).trim();
  }

  return { response, latencyMs };
}

// ---------------------------------------------------------------------------
// Mock (for testing without Ollama)
// ---------------------------------------------------------------------------

function mockResponse(prompt: Prompt): {
  response: string;
  latencyMs: number;
} {
  const delay = 50 + Math.random() * 100;

  if (prompt.expected_tool === "general_chat") {
    return {
      response: "This is a mock text response for a general chat question.",
      latencyMs: delay,
    };
  }

  const mockJson: ParsedResponse = {
    tool: prompt.expected_tool,
    parameters: { ...prompt.expected_params },
    message: `Mock confirmation for ${prompt.expected_tool}`,
  };

  return {
    response: JSON.stringify(mockJson),
    latencyMs: delay,
  };
}

// ---------------------------------------------------------------------------
// Response parsing & evaluation
// ---------------------------------------------------------------------------

function tryParseJson(raw: string): ParsedResponse | null {
  // Try direct parse
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.tool === "string") {
      return parsed as ParsedResponse;
    }
  } catch {
    // not pure JSON
  }

  // Try to extract JSON from markdown code blocks or mixed text
  const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed && typeof parsed.tool === "string") {
        return parsed as ParsedResponse;
      }
    } catch {
      // failed
    }
  }

  // Try to find JSON object in the response
  const braceMatch = raw.match(/\{[\s\S]*"tool"\s*:[\s\S]*\}/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      if (parsed && typeof parsed.tool === "string") {
        return parsed as ParsedResponse;
      }
    } catch {
      // failed
    }
  }

  return null;
}

function isToolResponse(raw: string): boolean {
  // Check if the response appears to be a tool call (JSON) vs plain text
  const trimmed = raw.trim();
  return (
    trimmed.startsWith("{") ||
    trimmed.startsWith("```json") ||
    trimmed.includes('"tool"')
  );
}

function evaluateResponse(
  prompt: Prompt,
  raw: string
): {
  json_valid: boolean;
  tool_correct: boolean;
  params_correct: boolean;
} {
  const isExpectedToolCall = prompt.expected_tool !== "general_chat";

  // For general_chat: the model should respond with plain text, NOT JSON
  if (!isExpectedToolCall) {
    const parsed = tryParseJson(raw);
    if (parsed) {
      // Model generated JSON — check if it correctly identified general_chat
      const tool_correct = parsed.tool === "general_chat";
      return {
        json_valid: true,
        tool_correct,
        params_correct: tool_correct,
      };
    }
    // Plain text response for general_chat = correct behavior
    return { json_valid: true, tool_correct: true, params_correct: true };
  }

  // For tool calls: must return valid JSON with correct tool
  const parsed = tryParseJson(raw);
  if (!parsed) {
    return { json_valid: false, tool_correct: false, params_correct: false };
  }

  const tool_correct = parsed.tool === prompt.expected_tool;

  // Check parameters — only validate keys that are in expected_params
  let params_correct = tool_correct;
  if (tool_correct && Object.keys(prompt.expected_params).length > 0) {
    const actualParams = parsed.parameters || {};
    for (const [key, expectedVal] of Object.entries(prompt.expected_params)) {
      const actualVal = actualParams[key];
      if (actualVal === undefined) {
        params_correct = false;
        break;
      }
      // For string values, do case-insensitive partial match
      if (typeof expectedVal === "string" && typeof actualVal === "string") {
        if (
          key === "time" ||
          key === "datetime" ||
          key === "start" ||
          key === "end"
        ) {
          // Exact match for time/date values
          if (!actualVal.includes(expectedVal)) {
            params_correct = false;
            break;
          }
        } else {
          // Partial case-insensitive match for text fields
          if (
            !actualVal.toLowerCase().includes(expectedVal.toLowerCase()) &&
            !expectedVal.toLowerCase().includes(actualVal.toLowerCase())
          ) {
            params_correct = false;
            break;
          }
        }
      } else if (typeof expectedVal === "number") {
        if (Number(actualVal) !== expectedVal) {
          params_correct = false;
          break;
        }
      }
    }
  }

  return { json_valid: true, tool_correct, params_correct };
}

// ---------------------------------------------------------------------------
// CSV output
// ---------------------------------------------------------------------------

function resultsToCsv(results: BenchmarkResult[]): string {
  const header =
    "id,input,lang,difficulty,json_valid,tool_correct,params_correct,latency_ms,raw_response,error";
  const rows = results.map((r) => {
    const escapeCsv = (s: string) =>
      `"${s.replace(/"/g, '""').replace(/\n/g, "\\n")}"`;
    return [
      r.id,
      escapeCsv(r.input),
      r.lang,
      r.difficulty,
      r.json_valid ? 1 : 0,
      r.tool_correct ? 1 : 0,
      r.params_correct ? 1 : 0,
      Math.round(r.latency_ms),
      escapeCsv(r.raw_response.slice(0, 500)),
      escapeCsv(r.error),
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// Summary stats
// ---------------------------------------------------------------------------

function printSummary(model: string, results: BenchmarkResult[]) {
  const total = results.length;
  const jsonValid = results.filter((r) => r.json_valid).length;
  const toolCorrect = results.filter((r) => r.tool_correct).length;
  const paramsCorrect = results.filter((r) => r.params_correct).length;
  const latencies = results.map((r) => r.latency_ms).sort((a, b) => a - b);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / total;
  const medianLatency = latencies[Math.floor(total / 2)];
  const p95Latency = latencies[Math.floor(total * 0.95)];

  const pct = (n: number) => ((n / total) * 100).toFixed(1);

  console.log("\n" + "=".repeat(70));
  console.log(`  MODEL: ${model}`);
  console.log("=".repeat(70));
  console.log(
    `  Total prompts:     ${total}`
  );
  console.log(
    `  JSON valid:        ${jsonValid}/${total} (${pct(jsonValid)}%)`
  );
  console.log(
    `  Tool correct:      ${toolCorrect}/${total} (${pct(toolCorrect)}%)`
  );
  console.log(
    `  Params correct:    ${paramsCorrect}/${total} (${pct(paramsCorrect)}%)`
  );
  console.log(
    `  Avg latency:       ${avgLatency.toFixed(0)}ms`
  );
  console.log(
    `  Median latency:    ${medianLatency.toFixed(0)}ms`
  );
  console.log(
    `  P95 latency:       ${p95Latency.toFixed(0)}ms`
  );

  // Breakdown by language
  for (const lang of ["it", "en"] as const) {
    const langResults = results.filter((r) => r.lang === lang);
    if (langResults.length === 0) continue;
    const lt = langResults.length;
    const ltTool = langResults.filter((r) => r.tool_correct).length;
    const ltParams = langResults.filter((r) => r.params_correct).length;
    console.log(
      `  [${lang.toUpperCase()}] Tool: ${ltTool}/${lt} (${((ltTool / lt) * 100).toFixed(1)}%) | Params: ${ltParams}/${lt} (${((ltParams / lt) * 100).toFixed(1)}%)`
    );
  }

  // Breakdown by difficulty
  for (const diff of ["easy", "medium", "ambiguous"] as const) {
    const diffResults = results.filter((r) => r.difficulty === diff);
    if (diffResults.length === 0) continue;
    const dt = diffResults.length;
    const dtTool = diffResults.filter((r) => r.tool_correct).length;
    const dtParams = diffResults.filter((r) => r.params_correct).length;
    console.log(
      `  [${diff.toUpperCase().padEnd(9)}] Tool: ${dtTool}/${dt} (${((dtTool / dt) * 100).toFixed(1)}%) | Params: ${dtParams}/${dt} (${((dtParams / dt) * 100).toFixed(1)}%)`
    );
  }

  // Breakdown by tool
  const tools = [...new Set(results.map((r) => {
    // Get expected tool from the prompt data
    return "";
  }))];

  console.log("=".repeat(70));

  // Exit gate check
  const easyMedium = results.filter(
    (r) => r.difficulty === "easy" || r.difficulty === "medium"
  );
  const emToolAcc =
    easyMedium.length > 0
      ? (easyMedium.filter((r) => r.tool_correct).length / easyMedium.length) *
        100
      : 0;
  const emJsonRate =
    easyMedium.length > 0
      ? (easyMedium.filter((r) => r.json_valid).length / easyMedium.length) *
        100
      : 0;

  const passToolGate = emToolAcc >= 90;
  const passJsonGate = emJsonRate >= 95;

  console.log("\n  EXIT GATE CHECK (easy+medium prompts):");
  console.log(
    `  Tool accuracy >=90%: ${emToolAcc.toFixed(1)}% ${passToolGate ? "PASS" : "FAIL"}`
  );
  console.log(
    `  JSON valid   >=95%: ${emJsonRate.toFixed(1)}% ${passJsonGate ? "PASS" : "FAIL"}`
  );
  console.log(
    `  Overall: ${passToolGate && passJsonGate ? "PASS - Ready for Fase 1" : "FAIL - Iterate on prompt/model"}`
  );
  console.log("");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const useMock = args.includes("--mock");
  noThink = args.includes("--no-think");
  const modelArg = args.find((a) => !a.startsWith("--"));
  const model = modelArg || "qwen3:4b";

  const modeLabel = useMock ? " (MOCK MODE)" : noThink ? " (NO-THINK)" : "";
  console.log(`\nVesta Fase 0 Benchmark`);
  console.log(`Model: ${model}${modeLabel}`);
  console.log(`Datetime: ${CURRENT_DATETIME} (${TIMEZONE})`);

  // Load prompts
  const promptsRaw = readFileSync(PROMPTS_FILE, "utf-8")
    .trim()
    .split("\n")
    .filter((line) => line.trim());
  const prompts: Prompt[] = promptsRaw.map((line) => JSON.parse(line));
  console.log(`Loaded ${prompts.length} prompts\n`);

  // Build system prompts (one per language)
  const systemPrompts: Record<string, string> = {
    it: buildSystemPrompt({
      lang: "it",
      datetime: CURRENT_DATETIME,
      timezone: TIMEZONE,
    }),
    en: buildSystemPrompt({
      lang: "en",
      datetime: CURRENT_DATETIME,
      timezone: TIMEZONE,
    }),
  };

  // Check Ollama is running (unless mock)
  if (!useMock) {
    try {
      const check = await fetch(`${OLLAMA_URL}/api/tags`);
      if (!check.ok) throw new Error(`Status ${check.status}`);
      console.log("Ollama is running.\n");
    } catch (e) {
      console.error(
        `ERROR: Cannot connect to Ollama at ${OLLAMA_URL}`
      );
      console.error(
        "Start Ollama with: ollama serve"
      );
      console.error(
        `Then pull the model: ollama pull ${model}`
      );
      console.error(
        "\nOr run with --mock flag to test without Ollama.\n"
      );
      process.exit(1);
    }
  }

  const results: BenchmarkResult[] = [];
  let completed = 0;

  for (const prompt of prompts) {
    completed++;
    const progress = `[${completed}/${prompts.length}]`;

    try {
      const systemPrompt = systemPrompts[prompt.lang];
      const { response, latencyMs } = useMock
        ? mockResponse(prompt)
        : await queryOllama(model, systemPrompt, prompt.input);

      const evaluation = evaluateResponse(prompt, response);

      const result: BenchmarkResult = {
        id: prompt.id,
        input: prompt.input,
        lang: prompt.lang,
        difficulty: prompt.difficulty,
        json_valid: evaluation.json_valid,
        tool_correct: evaluation.tool_correct,
        params_correct: evaluation.params_correct,
        latency_ms: latencyMs,
        raw_response: response,
        error: "",
      };

      results.push(result);

      const status = evaluation.tool_correct ? "OK" : "MISS";
      const toolInfo = evaluation.tool_correct
        ? prompt.expected_tool
        : `expected=${prompt.expected_tool}`;
      console.log(
        `${progress} ${status} ${prompt.id} (${prompt.lang}/${prompt.difficulty}) ${toolInfo} [${Math.round(latencyMs)}ms]`
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({
        id: prompt.id,
        input: prompt.input,
        lang: prompt.lang,
        difficulty: prompt.difficulty,
        json_valid: false,
        tool_correct: false,
        params_correct: false,
        latency_ms: 0,
        raw_response: "",
        error,
      });
      console.log(`${progress} ERR ${prompt.id}: ${error}`);
    }
  }

  // Write CSV
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }
  const safeModelName = model.replace(/[/:]/g, "-");
  const suffix = noThink ? "-no-think" : "";
  const csvPath = join(RESULTS_DIR, `${safeModelName}${suffix}.csv`);
  writeFileSync(csvPath, resultsToCsv(results));
  console.log(`\nResults saved to: ${csvPath}`);

  // Print summary
  printSummary(model, results);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
