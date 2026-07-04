# Vesta — GAMEPLAN

**The operational playbook. What to do, in what order, and how to know when to move on.**

*Intelligence that never leaves home.*

---

## Principles

1. **Done beats perfect.** Ship the ugly version, then polish. Every week must produce something that runs.
2. **Data before code.** Don't build infrastructure before proving the model can do the task.
3. **One layer at a time.** Each layer works independently. Don't start layer N+1 until layer N has hit its exit gate.
4. **Minimal native code.** TypeScript for everything except: LLM inference, Android Intents, Foreground Service. Those three are Kotlin/C++.
5. **Two languages from day 1.** English and Italian in every benchmark, every prompt template, every test.

---

## Fase 0: Model Validation (Week 1)

**Goal:** Choose THE model and THE system prompt. Everything else depends on this.

**What you do:**
- Install Ollama on Mac: `brew install ollama && ollama serve`
- Pull candidates: `ollama pull qwen3:4b`, `ollama pull qwen3:8b`, `ollama pull llama3.2:3b`
- Write benchmark script (TypeScript, runs via `npx tsx`): reads JSONL prompts → sends to Ollama → parses JSON response → compares with expected → writes CSV results
- Create prompt dataset: 50 IT + 50 EN covering 4 core tools (set_alarm, create_event, set_reminder, general_chat)
- Include colloquial variants: "svejami", "fissa", "metti su", "wake me", "set up a meeting"
- Include temporal ambiguity: "domani", "giovedì prossimo", "stasera", "next Thursday", "tonight"
- Run benchmark on each model. Analyze CSV. Pick winner.
- Iterate on system prompt to maximize accuracy. Test Hermes-style vs custom template.

**What you produce:**
- `scripts/benchmark/prompts.jsonl` — the dataset (100 prompts, 2 languages)
- `scripts/benchmark/run.ts` — the benchmark script
- `scripts/benchmark/results/` — CSV results per model
- `docs/FASE0-RESULTS.md` — which model won, why, accuracy numbers

**Exit gate:** ≥90% tool accuracy + ≥95% valid JSON on clear commands, in both IT and EN.

**If you fail the gate:** Try different system prompt structures. Add few-shot examples. Try constrainted JSON grammar in Ollama. If no model hits 90%, consider fine-tuning Qwen3 4B on a small Italian function-calling dataset (last resort).

---

## Fase 1: Android MVP (Week 2-4)

**Goal:** "Hey Vesta, svegliami alle 7" on a real Android phone → alarm is set. Offline.

**What you build:**
- React Native + Expo project (`npx create-expo-app vesta`)
- Native module: `LlamaCppModule` (Kotlin + JNI wrapping llama.cpp Android binding)
  - `initialize(modelPath, options)` → loads model
  - `generate(prompt, options)` → returns response (streaming via events)
  - `unload()` → frees RAM
- Native module: `SystemActionsModule` (Kotlin)
  - `setAlarm(time, date?, label?)` → `AlarmClock.ACTION_SET_ALARM`
  - `createEvent(title, start, end?, location?)` → `Intent.ACTION_INSERT`
  - `setReminder(text, datetime)` → scheduled notification
  - (general_chat has no system action — just returns LLM text)
- Native service: `VestaService` (Kotlin Foreground Service)
  - Keeps LLM in memory
  - Persistent notification: "Vesta is ready"
  - Auto-reload on crash
- TypeScript orchestrator:
  - `orchestrator.ts` — receives message, builds prompt, calls LLM, parses response
  - `tool-registry.ts` — 4 tools defined with JSON schema
  - `tool-dispatcher.ts` — maps JSON tool_call to native module method
- Chat UI: single screen, message list, text input. Minimal. No bells.
- Model download: on first launch, download .gguf from bundled URL or manual file pick

**What you produce:**
- Working Android APK (debug build)
- Video demo: voice/text command → LLM processes → alarm is set

**Exit gate:** End-to-end demo on real Android device (8GB+ RAM, Snapdragon 8 Gen 2+). Say "svegliami domani alle 7 e mezza" → alarm set at 07:30. Say "set an alarm for 6:45 AM" → alarm set at 06:45. All offline.

---

## Fase 2: Core Polish (Week 5-7)

**Goal:** All 10 core tools work. Conversation has memory.

**What you add:**
- 6 more tools: `make_call`, `send_sms`, `set_timer`, `navigate_to`, `get_calendar_events`, `search_contacts`
- Kotlin implementations: each maps to standard Android Intent or ContentResolver query
- Conversation history: last N messages stored in SQLite, injected into prompt context
- Memory extraction: after each conversation, LLM extracts key facts about user (optional, off by default)
- Settings screen: language preference (IT/EN), model selection, context length, confirm destructive actions toggle
- Error handling: if JSON is malformed, retry once with correction prompt. If still fails, respond as general_chat.

**Exit gate:** 10/10 tools work on device. A 5-message multi-turn conversation maintains context correctly. "Che appuntamenti ho domani?" reads real calendar data.

---

## Fase 3: Document Intelligence (Week 8-10)

**Goal:** Upload a PDF, ask questions about it, get accurate answers. Offline.

**What you add:**
- Document picker (expo-document-picker)
- Parsers: PDF (pdf-parse or pdfjs-dist via JS), DOCX (mammoth), TXT/MD (direct read)
- Chunking: 512 tokens, 64 token overlap, respect paragraph boundaries
- Embedding: `nomic-embed-text` via llama.cpp (same runtime, no new dependency)
- Vector store: sqlite-vec compiled for Android, loaded as SQLite extension
- New tool: `query_document` — embeds question, searches vectors, injects top-5 chunks in prompt
- RAG prompt template: "Answer based ONLY on these excerpts: ..."

**Exit gate:** Upload a 20-page PDF. Ask a specific factual question. Get correct answer with indication of which section it came from. All offline.

---

## Fase 4: On-device Performance

**Goal:** Make Vesta faster on the phone — shorter time-to-first-token and lower battery — without a second device.

**Context (spike):** llama.rn already reuses the KV cache in-memory across completions that share a prefix (measured prefill 17s → 0ms on a repeated prompt on a Pixel 10 Pro). So the win is *not* a persistent cache for normal chat — it's keeping the big, stable prompt prefix cacheable and shaving the cold-start cost.

**What you build:**
- **Prompt restructuring** (biggest win): the volatile datetime sat near the top of the system prompt, invalidating the KV cache for the whole tool-schema block every turn. New layout: a STABLE prefix — persona + format + static date-interpretation rules + tool schemas, with semi-stable memories/knowledge at its end — and a VOLATILE tail holding only the current date context (datetime at minute precision, today/tomorrow).
  - *Benchmark re-run (2026-07-01, Ollama qwen3:4b, easy+medium):* thinking config **98.9% tool / 100% JSON** vs the 97.8%/98.9% March baseline — **gate holds, slightly improved**. No-think config 92.2%/93.3% vs its 93.3%/94.4% baseline — within run-to-run noise (temperature 0.1, unseeded; the misses are that config's known empty-response truncation flakes, present in the baseline too). No response in any run copied the `"YYYY-MM-DDTHH:MM:SS"` format placeholder. Caveat: the benchmark covers the 4-tool MVP subset, not the 5 post-MVP routing rules (Fase 2/3), so on-device spot checks of the other tools are still needed.
- **Cheap wins**: user-tunable CPU threads, KV-cache quantization (q8_0), and mlock, in Settings, applied at model load.
- **Persistent prefix-KV cache** (narrow, cold-start only): the stable-prefix KV state is saved to disk after the first clean turn (`saveSession`) and restored right after model load (`loadSession`), before any completion — at app start and on model switch. Keyed by hash(model path + prefix text), so any model/memories/knowledge/language change invalidates it; restored content is validated against the prefix text and deleted on mismatch; every failure degrades to a cold start.
  - *Measured (2026-07-04, Pixel 10 Pro, Qwen3 4B Q4_K_M):* first message after a fresh launch **37.3s → 2.8s prefill (13.4x)** — logcat `n_past=1443, num_prompt_tokens=1514` (only tail + message re-prefilled). Restore log: `restored 1443 prefix tokens from disk`.
  - *Cost caveat:* llama.cpp's session save serializes the FULL KV state regardless of the token bound — the file is **215 MB** (Qwen3 4B, f16 KV, ~1450 tokens). One file, overwritten in place; saves are debounced (120s) and skipped while the on-disk hash matches. KV q8_0 (cheap-wins toggle) would roughly halve it.
  - *Byte-stability fix required:* the memories block was ordered by a `Date.now()`-based decay score, so the "stable" prefix bytes drifted with the wall clock — silently breaking both this cache and the in-session KV reuse from the prompt restructure. Memories are now emitted in canonical insertion order (ranking still decides which ones make the cut).
- **Benchmark** (formal before/after via `timings.promptMs`, dev command `/benchmark-prefill`): frozen pre-restructure V2 prompt vs current V3 layout, 6 scripted turns per arm, injected clock +70s/turn (every turn crosses a minute boundary), identical canned history, KV cleared per arm, V2 first so thermal throttling penalizes V3.
  - *Measured (2026-07-04, Pixel 10 Pro, Qwen3 4B Q4_K_M):* V2 re-prefilled the full prompt every turn (49–70s); V3 warm turns re-prefilled only tail + history. **Warm-turn mean (turns 2–6): V2 66.9s vs V3 10.2s → 6.6x**, a lower bound — V3's cold turn ran 69.3s vs V2's 49.2s because the device was already throttled when its arm started.

**Known limitation / future work:** the volatile date context still lives at the end of the system prompt, so conversation history after it re-prefills whenever the minute changes between turns. Datetime is minute-precision, so same-minute turns are pure appends; the full fix (per-turn date injection replayed byte-identically in history) is deferred.

**Exit gate:** Measurable prefill-latency reduction on repeated prompts on a real device, with no tool-accuracy regression (Fase 0 benchmark holds). **Measured 2026-07-04: warm turns 6.6x faster (prompt restructure), cold start 13.4x faster (persistent prefix cache); Fase 0 gate re-verified 2026-07-01 (98.9% tool / 100% JSON).** Remaining: cheap-wins settings (threads/KV-quant/mlock, PR #17 open).

---

## Parked — Mac Hub & iOS (Android-first focus)

Deferred while the focus is a great single-device Android experience:
- **Mac Hub (Vesta Hearth)**: optional LAN hub delegating heavy queries to a 70B model on a Mac (Node + WebSocket + mDNS, with graceful local fallback).
- **iOS Port**: MLX-Swift inference + App Intents, same RN UI.

Both remain on the long-term roadmap; neither is a current priority.

---

## Fase 5: MCP + Advanced (future)

**MCP (Model Context Protocol) is the strategic play.**

Aaron Levie (Box CEO) nailed it: "If you don't have an API for a feature, it might as well not exist. If it can't be exposed through a CLI or MCP server, you're at a disadvantage."

The insight: Vesta isn't just a personal assistant — it can become the **local infrastructure that cloud agents use when they need to act on your device**. If Vesta exposes its tools as an MCP server running locally, then Claude Code, Cursor, OpenClaw, or any MCP-compatible agent can ask Vesta to set an alarm, read your calendar, or search your documents on your behalf. Vesta becomes the bridge between cloud intelligence and local action.

This is a massive positioning upgrade: from "offline assistant" to "the local agent runtime that everything else plugs into."

**What to build:**
- Vesta MCP Server: expose all Vesta tools as MCP-compatible endpoints on localhost
- Protocol: any agent on the same device or LAN can discover and call Vesta tools
- Authentication: user approves which external agents can use Vesta (consent-based)
- Use case: Claude Code asks Vesta to "check my calendar for tomorrow" → Vesta reads local calendar → returns data → Claude Code uses it in its workflow. All without the calendar data ever leaving the device.

**Other Fase 5 candidates:**
- Interactive tutor (study plans, quizzes, Socratic mode)
- Multi-agent swarm (specialized agents collaborating)
- Accessibility Service (Android, opt-in, sideload only — NOT for Play Store)
- Offline knowledge base (Wikipedia IT dump, recipe database)

Exit gates defined per-feature when each starts.

---

## Decision Log

Track key decisions here as you make them during development.

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-03-08 | Project name: Vesta | Roman goddess of the hearth. "Intelligence that never leaves home." |
| 2026-03-08 | Android first, iOS later | Android is more open. React Native enables both. |
| 2026-03-08 | llama.cpp as sole runtime | Official Android binding, any GGUF, no recompilation. |
| 2026-03-08 | React Native + minimal Kotlin | Developer is TS-native. Kotlin only for 3 native modules. |
| 2026-03-08 | English + Italian from day 1 | Global product, Italian stress-test. Tier 2 langs at month 3-6. |
| 2026-03-08 | MCP server in Fase 6 (now Fase 5) | Levie's "API-first for agents" thesis. Vesta as local agent infra. |
| 2026-06-25 | Fase 1 complete | Android MVP exit gate met on real hardware: end-to-end alarm/event/reminder fully offline. |
| 2026-06-25 | Fase 2 code-complete | All 10 tools (calls, SMS, contacts, calendar read) + query loop + error recovery shipped across PRs #11–#13, CI-verified (typecheck/lint/tests/Android build). On-device verification of the new contacts/calendar tools is pending a rebuild; the exit-gate scenario ("che appuntamenti ho domani?" reading real calendar data) has not yet been run on hardware. |
| 2026-07-01 | Fase 2 complete (verified on device) | Rebuilt on a Pixel 10 Pro after fixing an autolinking gap (expo-contacts/expo-calendar were not compiled into the APK, crashing boot). Exit gate met on hardware, fully offline: "che appuntamenti ho domani?" reads real calendar data; timer, contact search, and confirm-gated calls also verified on device. Added the missing malformed-JSON retry-once-with-correction (GAMEPLAN Fase 2 error-handling requirement). |
| 2026-07-01 | Fase 3 complete (verified on device) | On-device document RAG: `query_document` tool + a second llama.rn context running the Nomic embed model + brute-force cosine over BLOB-stored vectors (no sqlite-vec — Expo SQLite can't load extensions). Exit gate met on a Pixel 10 Pro, fully offline (airplane mode): imported a PDF, asked a factual question, got a grounded answer. PDF needed DOM polyfills (DOMException/DOMMatrix) to run pdfjs under Hermes. |

---

## Weekly Check-in Template

Copy this each Friday:

```
## Week N — [Date]

### What shipped:
- 

### Exit gate status:
- [ ] Gate condition 1
- [ ] Gate condition 2

### Blocked by:
- 

### Next week:
- 

### Key learning:
- 
```
