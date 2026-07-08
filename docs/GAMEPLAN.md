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

## Roadmap at a glance

| Fase | Scope | Status | Exit gate |
|---|---|---|---|
| **0 — Model Validation** | Benchmark models + system prompt on Ollama | ✅ Done (2026-03-09) | ≥90% tool / ≥95% JSON on easy+medium — met at 97.8% / 98.9% |
| **1 — Android MVP** | 4 tools, chat UI, llama.rn, foreground service | ✅ Done (2026-06-25, v0.1.0) | "svegliami domani alle 7 e mezza" → alarm set, real device, offline |
| **2 — Core Polish** | All 10 tools, query loop, history, settings, JSON retry | ✅ Done (2026-07-01) | 10/10 tools on device; calendar read returns real data |
| **3 — Document Intelligence** | PDF/DOCX/TXT RAG, fully on device | ✅ Done (2026-07-01) | PDF question → grounded answer in airplane mode |
| **4 — On-device Performance** | KV-cache prompt layout (V3 then V4), cold-start session cache, perf settings | ✅ Done (2026-07-06) | Warm turns: full re-prefill → pure appends (flat ~6s); cold start 13.4x; Fase 0 gate holds (98.9% / 100%) |
| **5 — Reliability & Release** | v0.2.0 signed release, failure-path hardening, low-memory story, regression tests, on-device diagnostics | 🔜 Next | Signed v0.2.0 installable from GitHub Releases; zero known silent-failure paths; every Fase 1–4 on-device bug class has a regression test |
| **6 — MCP + Advanced** | Local MCP server, tutor, swarm, offline knowledge | 📋 Future | Per-feature, defined when each starts |
| *Parked* | Mac Hub (LAN 70B delegation), iOS port | ⏸️ Parked | — |

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
- Vector store: embeddings as float32 BLOBs in SQLite, brute-force cosine scan in TypeScript (sqlite-vec was the plan, but Expo SQLite can't load extensions — see Decision Log 2026-07-01)
- New tool: `query_document` — embeds question, searches vectors, injects top-5 chunks in prompt
- RAG prompt template: "Answer based ONLY on these excerpts: ..."

**Exit gate:** Upload a 20-page PDF. Ask a specific factual question. Get correct answer with indication of which section it came from. All offline.

---

## Fase 4: On-device Performance

**Goal:** Make Vesta faster on the phone — shorter time-to-first-token and lower battery — without a second device.

**Context (spike):** llama.rn already reuses the KV cache in-memory across completions that share a prefix (measured prefill 17s → 0ms on a repeated prompt on a Pixel 10 Pro). So the win is *not* a persistent cache for normal chat — it's keeping the big, stable prompt prefix cacheable and shaving the cold-start cost.

**What you build:**
- **Prompt restructuring** (biggest win): the volatile datetime sat near the top of the system prompt, invalidating the KV cache for the whole tool-schema block every turn. V3 layout (PR #18, since superseded by V4 below): a STABLE prefix — persona + format + static date-interpretation rules + tool schemas, with semi-stable memories/knowledge at its end — and a VOLATILE tail holding only the current date context (datetime at minute precision, today/tomorrow).
  - *Benchmark re-run (2026-07-01, Ollama qwen3:4b, easy+medium):* thinking config **98.9% tool / 100% JSON** vs the 97.8%/98.9% March baseline — **gate holds, slightly improved**. No-think config 92.2%/93.3% vs its 93.3%/94.4% baseline — within run-to-run noise (temperature 0.1, unseeded; the misses are that config's known empty-response truncation flakes, present in the baseline too). No response in any run copied the `"YYYY-MM-DDTHH:MM:SS"` format placeholder. Caveat: the benchmark covers the 4-tool MVP subset, not the 5 post-MVP routing rules (Fase 2/3), so on-device spot checks of the other tools are still needed.
- **Cheap wins**: user-tunable CPU threads, KV-cache quantization (q8_0), and mlock, in Settings, applied at model load.
  - *Verified on device (2026-07-04, Pixel 10 Pro):* q8_0 KV + flash attention loads and generates correctly on this llama.rn build, and the session-cache file confirms the memory claim (146 MB vs ~283 MB f16 at the same state size). The speed cost on CPU-only inference is real: back-to-back at the same thermal state, prefill ~42 → ~62 ms/token and decode 3.3 → 2.0 tok/s (~1.5x slower). Defaults stay OFF — the toggle trades speed for fitting longer contexts in RAM. A perf-settings change also invalidates the prefix session cache by design (KV cells are stored typed).
- **Persistent prefix-KV cache** (narrow, cold-start only): the stable-prefix KV state is saved to disk after the first clean turn (`saveSession`) and restored right after model load (`loadSession`), before any completion — at app start and on model switch. Keyed by hash(model path + prefix text), so any model/memories/knowledge/language change invalidates it; restored content is validated against the prefix text and deleted on mismatch; every failure degrades to a cold start.
  - *Measured (2026-07-04, Pixel 10 Pro, Qwen3 4B Q4_K_M):* first message after a fresh launch **37.3s → 2.8s prefill (13.4x)** — logcat `n_past=1443, num_prompt_tokens=1514` (only tail + message re-prefilled). Restore log: `restored 1443 prefix tokens from disk`.
  - *Cost caveat:* llama.cpp's session save serializes the FULL KV state regardless of the token bound — the file is **215 MB** (Qwen3 4B, f16 KV, ~1450 tokens). One file, overwritten in place; saves are debounced (120s) and skipped while the on-disk hash matches. KV q8_0 (cheap-wins toggle) would roughly halve it.
  - *Byte-stability fix required:* the memories block was ordered by a `Date.now()`-based decay score, so the "stable" prefix bytes drifted with the wall clock — silently breaking both this cache and the in-session KV reuse from the prompt restructure. Memories are now emitted in canonical insertion order (ranking still decides which ones make the cut).
- **Benchmark** (formal before/after via `timings.promptMs`, dev command `/benchmark-prefill`): frozen pre-restructure V2 prompt vs current V3 layout, 6 scripted turns per arm, injected clock +70s/turn (every turn crosses a minute boundary), identical canned history, KV cleared per arm, V2 first so thermal throttling penalizes V3.
  - *Measured (2026-07-04, Pixel 10 Pro, Qwen3 4B Q4_K_M):* V2 re-prefilled the full prompt every turn (49–70s); V3 warm turns re-prefilled only tail + history. **Warm-turn mean (turns 2–6): V2 66.9s vs V3 10.2s → 6.6x**, a lower bound — V3's cold turn ran 69.3s vs V2's 49.2s because the device was already throttled when its arm started.

- **Per-turn date injection (V4)** — closes the deferred limitation above: the system prompt is now fully STATIC and the date rides in a `[Contesto temporale: ...]` line prepended to each user message. History turns render it from each message's stored `createdAt` (a pure function), so replayed history is byte-identical forever and every turn is a pure KV append — the V3 layout's date tail sat between the cached prefix and the history and re-prefilled the whole conversation on every minute boundary (measured: warm turns growing 6.7s → 15s). Also fixed en route: the current user message was being sent to the model TWICE (history included it and the orchestrator appended it again — pre-existing since Fase 1).
  - *Fase 0 benchmark re-run (2026-07-06, Ollama qwen3:4b, easy+medium):* thinking config **98.9% tool / 100% JSON** — identical to the V3 re-run, above the 97.8%/98.9% March baseline. No-think config 93.3%/94.4% — exactly the March baseline's numbers (the 94.4% JSON is that config's known empty-response truncation flake, present in every run). Gate holds under the annotation format.
  - *Measured on device (2026-07-06, Pixel 10 Pro, Qwen3 4B Q4_K_M, 3-arm `/benchmark-prefill`, warm turns 2–6):* V2 re-prefills everything (~64–79s/turn, logcat `n_past=54`); V3 re-prefills tail+history, growing 5.1s → 12.0s as history accumulates (`n_past=1456` fixed); **V4 stays flat at ~5.9–6.5s** (`n_past` = previous turn's full prompt, every turn a pure append) — last turn **6.4s vs V3's 12.0s**, and the gap widens with history. V4's prompts were even LARGER (annotations add ~90 tok/turn: 2029 vs 1656 tokens at turn 6). Arms ran V2→V3→V4, so throttling penalized V4.
  - *Live-chat evidence (same device):* turn sent 5 minutes after the previous one showed `n_past=1675, num_prompt_tokens=1781` — 106 new tokens prefilled, zero history re-prefill across minute boundaries; query-loop followup `n_past=1847/2990` (prefix shared). Date resolution verified from the annotation: "svegliami domani alle 7 e mezza" → `set_alarm {time: "07:30", date: "2026-07-07"}` (confirm-gated, cancelled); "che appuntamenti ho domani" → grounded calendar answer for the right day.

**Known limitations — triaged in Fase 5 (see Decision Log 2026-07-07):** (a) history-window slide — FIXED: the window start is now anchored to a stride (`historyWindowStart`), so a long conversation stays a pure KV append between stride jumps instead of re-prefilling every turn; (b) a device timezone change re-renders history time contexts from the next app launch (one cold start, then stable — the zone string is frozen per process) — ACCEPTED (rare, one-time); (c) a confirmed/declined pending action updates that assistant message's `[Tool: ...]` suffix, re-prefilling from that point once — ACCEPTED (rare, bounded, and the suffix is what lets the model see the outcome).

**Exit gate:** Measurable prefill-latency reduction on repeated prompts on a real device, with no tool-accuracy regression (Fase 0 benchmark holds). **Measured 2026-07-04: warm turns 6.6x faster (prompt restructure), cold start 13.4x faster (persistent prefix cache); Fase 0 gate re-verified 2026-07-01 (98.9% tool / 100% JSON).** Cheap-wins settings shipped and device-verified 2026-07-04 (PR #17). **Fase 4 complete** (PRs #18, #19, #20, #17, #22).

---

## Parked — Mac Hub & iOS (Android-first focus)

Deferred while the focus is a great single-device Android experience:
- **Mac Hub (Vesta Hearth)**: optional LAN hub delegating heavy queries to a 70B model on a Mac (Node + WebSocket + mDNS, with graceful local fallback).
- **iOS Port**: MLX-Swift inference + App Intents, same RN UI.

Both remain on the long-term roadmap; neither is a current priority.

---

## Fase 5: Reliability & Release

**Goal:** Turn what shipped in Fase 1–4 into a solid, releasable platform. No new user-facing features — everything here is about trust: the app fails loudly, recovers cleanly, and installs from a signed release.

**Why now:** everything since v0.1.0 (all of Fase 2, 3, 4) sits unreleased on main, two of the failure paths found in the code audit are silent, and the resident-model design has no story for OS memory pressure. Features can wait; reliability debt compounds.

**What you build (each item has its own gate):**

1. **v0.2.0 release** — workflow DRAFTED, awaiting the owner's one-time keystore setup. `.github/workflows/release.yml` (tag-triggered) builds `assembleRelease` signed via the `with-android-signing` config plugin (release build type uses the upload keystore when the `VESTA_UPLOAD_*` Gradle props are set, else debug — so normal builds are unaffected) and attaches the APK to the GitHub Release. `app.json` bumped to 0.2.0 + `versionCode` 2. Remaining (owner-only, see `docs/RELEASING.md`): generate the keystore + set the 4 secrets, then push a `v0.2.0` tag.
   *Gate: a signed, installable APK downloadable from the GitHub Releases page — blocked on the keystore/secrets.*
2. **Silent-failure elimination** — persistence errors are currently `console.error`-only (chat-store save paths); surface them to the UI as a non-blocking banner, and audit every catch block in `lib/` for swallowed user-relevant failures.
   *Gate: grep-verified — no catch path drops a user-relevant failure silently.*
3. **Low-memory story** — DONE (native handler shipped). RN's AppState `memoryWarning` never fires on Android (RN 0.83), so `SystemActionsModule` hooks native `onTrimMemory` and forwards real pressure to JS, which releases the embedding context (the only cheap-to-rebuild resource); the chat model stays resident by design (ADR-016). The session cache is deliberately left alone: it has no cancellable pending work (its debounce is a `Date.now()` gate, not a timer), and clearing it would delete the cache that makes the START_STICKY restart cheap (~3s). Documented position: the OS may still kill us, the foreground service restarts, the prefix cache absorbs the cold start.
   *Gate: documented behavior + no crash under `adb shell am send-trim-memory` sweep. MET (Pixel 10 Pro, 2026-07-07): backgrounded trim sweep — native logs show `onTrimMemory level=10/15 → emitting memoryWarning to JS`; app survived every level (same pid, no FATAL). Confirms the native ComponentCallbacks2 → device-event path.*
4. **Regression tests for on-device bug classes** — DONE. Audit found most classes were already covered (param normalization → `param-normalize.test.ts`; duplicate message → `history-stability.test.ts`; session-cache self-heal → `session-cache.test.ts`; malformed-JSON retry → `retry.test.ts`). The two genuine gaps are now filled: the migration chain (`migrations.test.ts` — empty DB → latest, in order, atomic, idempotent) and download resume/corruption (`download-manager.test.ts` — truncation rejected, pause/resume tokens, cancel race never commits). SQLite is tested against a faithful in-memory fake of the expo-sqlite surface, not a real engine (node:sqlite needs an experimental flag on CI's Node 22).
   *Gate: each named bug class has a test that fails on the pre-fix code. Met.*
5. **Accepted-limitations triage** — DONE. The three known re-prefill cases each got a decision (Decision Log 2026-07-07): the 20-message window slide was FIXED (anchored window, `historyWindowStart`); the timezone-change re-render and the `[Tool:]` suffix update were formally ACCEPTED (both rare and bounded).
   *Gate: none left undecided. Met.*
6. **On-device diagnostics screen** — BUILT (`app/diagnostics.tsx`, reachable from Settings). Shows model (name, file, context size, KV-cache type), last-turn prefill ms + prompt tokens evaluated (the JS-visible proxy for KV reuse — `n_past` isn't exposed to JS, but `tokens_evaluated` is the prefill work done this turn), and storage (database size, prefix-cache size / token count / primed). The offline-first substitute for telemetry, promoted from adb-only to in-app.
   *Gate: screen shows live values on device. MET (Pixel 10 Pro, 2026-07-07): Settings→Diagnostics renders model Qwen3 4B Instruct 2507 / ctx 4096 / KV f16, and Storage DB 104 KB, Prefix cache 224 MB / 1519 tokens / primed Yes — which also live-confirms the cold-start session cache restored at boot.*

**Out of scope (explicitly):** Play Store / F-Droid distribution (accounts + signing policy decisions — separate call), new tools, new languages, encryption at rest (candidate for a later phase, see ARCHITECTURE §8).

**Exit gate:** v0.2.0 tagged and signed; zero known silent-failure paths; every Fase 1–4 on-device bug class covered by a regression test.

---

## Fase 6: MCP + Advanced (future)

**MCP (Model Context Protocol) is the strategic play.**

Aaron Levie (Box CEO) nailed it: "If you don't have an API for a feature, it might as well not exist. If it can't be exposed through a CLI or MCP server, you're at a disadvantage."

The insight: Vesta isn't just a personal assistant — it can become the **local infrastructure that cloud agents use when they need to act on your device**. If Vesta exposes its tools as an MCP server running locally, then Claude Code, Cursor, OpenClaw, or any MCP-compatible agent can ask Vesta to set an alarm, read your calendar, or search your documents on your behalf. Vesta becomes the bridge between cloud intelligence and local action.

This is a massive positioning upgrade: from "offline assistant" to "the local agent runtime that everything else plugs into."

**What to build:**
- Vesta MCP Server: expose all Vesta tools as MCP-compatible endpoints on localhost
- Protocol: any agent on the same device or LAN can discover and call Vesta tools
- Authentication: user approves which external agents can use Vesta (consent-based)
- Use case: Claude Code asks Vesta to "check my calendar for tomorrow" → Vesta reads local calendar → returns data → Claude Code uses it in its workflow. All without the calendar data ever leaving the device.

**Slice 1 — Local MCP server: SHIPPED (verified on a Pixel 10 Pro, 2026-07-08).**
Read-only MCP server over the LAN: a native NanoHTTPD transport + auth gate in the
Android layer (`POST /mcp`, JSON-RPC 2.0, no SSE, binds `0.0.0.0`) forwards raw
requests to a TypeScript MCP engine that reuses the tool registry and dispatcher.
Exposes exactly the three `returnsData` read tools (`get_calendar_events`,
`search_contacts`, `query_document`) and returns their **structured data, not a
generated answer** — over MCP the host agent reasons, so Vesta skips the
orchestrator's generation loop. Per-client bearer tokens are minted/revoked in a
new Settings → MCP screen, owned in SQLite by TS (migration v3) and pushed into the
native in-memory set; the native layer never opens the DB. Off by default.

Exit gate met on hardware from a laptop on the same Wi-Fi: `initialize` + `tools/list`
returned the three tools; `tools/call` returned real on-device data (calendar events,
contacts, and a retrieved PDF passage for `query_document` — retrieval ran, generation
skipped); a non-read tool (`make_call`) was refused (`isError`, never dispatched); an
absent/wrong/revoked token → 401 (`{"error":"unauthorized"}`), a non-`/mcp` path → 404;
revoking a client in-app made its token fail instantly. Slice 1 assumes Vesta is
foregrounded during MCP use. Deferred to later slices: action (write) tools with a
remote-confirm UX, mDNS discovery, TLS, boot-time auto-restore, and a
`ConnectivityManager.NetworkCallback` rebind on network change.

**Other Fase 6 candidates:**
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
| 2026-03-08 | MCP server as its own phase (now Fase 6) | Levie's "API-first for agents" thesis. Vesta as local agent infra. |
| 2026-06-25 | Fase 1 complete | Android MVP exit gate met on real hardware: end-to-end alarm/event/reminder fully offline. |
| 2026-06-25 | Fase 2 code-complete | All 10 tools (calls, SMS, contacts, calendar read) + query loop + error recovery shipped across PRs #11–#13, CI-verified (typecheck/lint/tests/Android build). On-device verification of the new contacts/calendar tools is pending a rebuild; the exit-gate scenario ("che appuntamenti ho domani?" reading real calendar data) has not yet been run on hardware. |
| 2026-07-01 | Fase 2 complete (verified on device) | Rebuilt on a Pixel 10 Pro after fixing an autolinking gap (expo-contacts/expo-calendar were not compiled into the APK, crashing boot). Exit gate met on hardware, fully offline: "che appuntamenti ho domani?" reads real calendar data; timer, contact search, and confirm-gated calls also verified on device. Added the missing malformed-JSON retry-once-with-correction (GAMEPLAN Fase 2 error-handling requirement). |
| 2026-07-01 | Fase 3 complete (verified on device) | On-device document RAG: `query_document` tool + a second llama.rn context running the Nomic embed model + brute-force cosine over BLOB-stored vectors (no sqlite-vec — Expo SQLite can't load extensions). Exit gate met on a Pixel 10 Pro, fully offline (airplane mode): imported a PDF, asked a factual question, got a grounded answer. PDF needed DOM polyfills (DOMException/DOMMatrix) to run pdfjs under Hermes. |
| 2026-07-04 | Fase 4 complete (measured on device) | Stable-prefix prompt restructure (PR #18): warm turns 6.6x faster. Cold-start prefix session cache (PR #20): first message 37.3s → 2.8s (13.4x); llama.cpp serializes the FULL KV state so the file is ~215MB — saves debounced. Perf settings (PR #17): q8_0 KV + flash attention verified working; halves KV memory, ~1.5x slower on CPU — defaults off. |
| 2026-07-06 | V4 per-turn date injection (PR #22) | Closes the deferred history-re-prefill limitation: fully static system prompt + [Contesto temporale: ...] line per user message, rendered from each message's createdAt — history replays byte-identically, every turn a pure KV append (warm turns flat ~6s vs V3's 5→12s growth). Also fixed a since-Fase-1 bug: the current user message reached the model twice. |
| 2026-07-07 | Fase 5 = Reliability & Release; MCP moves to Fase 6 | Everything since v0.1.0 (Fase 2–4) is unreleased on main; a docs/code audit found silent persistence failures, no memory-pressure handling, and no release pipeline. Ship trust before features: signed v0.2.0, loud failures, regression tests for every on-device bug class. MCP keeps its scope, one slot later. Same audit realigned ARCHITECTURE/SPEC to the implemented reality (10 new ADRs: llama.rn, no cascade, no sqlite-vec, V4 prompt, session cache, perf defaults, no auto-unload). |
| 2026-07-07 | Known-limitations triage | (a) 20-message window slide — FIXED: `slice(-20)` re-sliced every turn, so a conversation past 20 messages re-prefilled the whole window each turn (worse than the "once per slide" the docs implied). Now `historyWindowStart` anchors the window start to an 8-message stride: byte-identical head between jumps (pure append), one re-prefill per stride instead of per turn — ~4x fewer, window bounded to ≤27 messages. (b) timezone-change re-render and (c) `[Tool:]` suffix re-prefill — ACCEPTED: both rare and bounded; (c)'s suffix is required for the model to see the tool outcome. |
| 2026-07-07 | Fase 5 complete except the release | Items 2–6 shipped and merged (#25 silent-failure notices, #26 low-memory onTrimMemory, #27 regression tests, #28 window-slide fix + triage, #29 diagnostics), test suite 180. #26 and #29 device-verified on a Pixel 10 Pro (native trim logs; live diagnostics values). Item 1 (signed v0.2.0) is DRAFTED (#30: `release.yml` + guarded `with-android-signing` plugin + `docs/RELEASING.md`, app.json→0.2.0) but the actual release is user-blocked on the owner generating a keystore + setting 4 secrets. |
| 2026-07-08 | Fase 6 slice 1 complete (verified on device) | Local MCP server: read-only tools over the LAN (native NanoHTTPD transport + auth gate, TS JSON-RPC engine reusing the registry/dispatcher, per-client bearer tokens in SQLite pushed to native memory, Settings → MCP screen). Built via subagent-driven TDD (12 commits, 8 tasks, per-task + whole-branch review); the review loop caught 4 real bugs the plan's own code had (never-throws on `"null"` bodies, a Kotlin `serve()` pending-leak + mis-mapped 202, a stale-IP/swallowed-error pair in the UI). Full jest suite 206/206, typecheck clean, `assembleDebug` green. Exit gate met on a Pixel 10 Pro from a laptop over Wi-Fi: `tools/list`+`tools/call` return real calendar/contacts/RAG data-not-answers, non-read tools refused, absent/revoked token → 401, revoke propagates instantly. Deferred: write tools + remote-confirm, mDNS, TLS, boot-restore, NetworkCallback rebind. |

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
