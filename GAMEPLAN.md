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

## Fase 4: Mac Hub — Vesta Hearth (Week 11-13)

**Goal:** Phone auto-discovers Mac on LAN, delegates heavy tasks, falls back gracefully.

**What you build:**
- Mac server: Node.js + Express + WebSocket + Ollama client + mDNS advertisement
- Phone client: WebSocket connection + mDNS scan (via react-native-zeroconf)
- Protocol: CHAT, EMBED, STREAM_START/CHUNK/END, PING/PONG
- Connection manager in orchestrator: if Hub connected → delegate. If not → process locally.
- UI indicator: 🟢 "Vesta Hearth connected" / 📱 "Local mode"

**Exit gate:** Phone on same WiFi as Mac → auto-connects. Ask complex question → answered by 70B model on Mac. Disconnect WiFi → same question answered by local 4B model. Transparent to user.

---

## Fase 5: iOS Port (Week 14-17)

- MLX-Swift native module for inference
- App Intents framework for system actions (alarm, calendar, contacts)
- Same React Native UI, different native bridge
- **Exit gate:** Same demo ("svegliami alle 7") works on iPhone.

---

## Fase 6: MCP + Advanced (Week 18+)

**MCP (Model Context Protocol) is the strategic play.**

Aaron Levie (Box CEO) nailed it: "If you don't have an API for a feature, it might as well not exist. If it can't be exposed through a CLI or MCP server, you're at a disadvantage."

The insight: Vesta isn't just a personal assistant — it can become the **local infrastructure that cloud agents use when they need to act on your device**. If Vesta exposes its tools as an MCP server running locally, then Claude Code, Cursor, OpenClaw, or any MCP-compatible agent can ask Vesta to set an alarm, read your calendar, or search your documents on your behalf. Vesta becomes the bridge between cloud intelligence and local action.

This is a massive positioning upgrade: from "offline assistant" to "the local agent runtime that everything else plugs into."

**What to build:**
- Vesta MCP Server: expose all Vesta tools as MCP-compatible endpoints on localhost
- Protocol: any agent on the same device or LAN can discover and call Vesta tools
- Authentication: user approves which external agents can use Vesta (consent-based)
- Use case: Claude Code asks Vesta to "check my calendar for tomorrow" → Vesta reads local calendar → returns data → Claude Code uses it in its workflow. All without the calendar data ever leaving the device.

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
| 2026-03-08 | MCP server in Fase 6 | Levie's "API-first for agents" thesis. Vesta as local agent infra. |
| | | |

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
