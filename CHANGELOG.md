# Changelog

All notable changes to Vesta are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Fase 5 — Reliability & Release begins with silent-failure elimination: a
persistence write that failed used to only log to the console, so a message or
reply that didn't reach SQLite vanished on the next restart with no signal.

### Fixed — Fase 5

- **Persistence failures are now surfaced** — every failed database write in the
  chat flow (user message, assistant reply, pending confirmation, tool result)
  raises a dismissible amber notice ("Couldn't save to storage — this message
  may be lost if you restart") instead of only a `console.error`. The in-memory
  turn is unaffected; the user just learns it may not survive a restart.
- **Honest startup state** — when a selected model fails to load at boot (e.g. a
  transient low-memory start), the chat now says "Couldn't load <model> — open
  Models to retry" instead of showing the misleading "no model — tap to
  download" banner for a model that is actually installed.

### Added — Fase 5

- **Memory-pressure handling** — Android delivers low-memory warnings through
  native `onTrimMemory` (React Native's `AppState` `memoryWarning` event never
  fires on Android), so `SystemActionsModule` now hooks it and forwards real
  pressure to JS, which releases the embedding context (~1s to reload). The chat
  model stays resident by design; if the OS still reclaims the process, the
  foreground service restarts it and the prefix session cache keeps the cold
  start cheap.
- **`NoticeBanner`** — a reusable, auto-dismissing amber banner for non-fatal
  notices, distinct from the red fatal-error banner.

Fase 4 — On-device Performance makes Vesta dramatically faster on the phone,
all measured on a Pixel 10 Pro with Qwen3 4B: warm turns went from a full
prompt re-prefill (~67s) to flat ~6s pure KV-cache appends, and the first
message after a cold app start went from 37.3s to 2.8s (13.4x).

### Added — Fase 4

- **KV-cache-friendly prompt architecture** (#18, #22) — the system prompt is
  now fully static (persona, rules, tool schemas, memories, knowledge) and the
  current date rides in a `[Time context: ...]` line prepended to each user
  message, rendered from that message's stored timestamp. Conversation history
  replays byte-identically, so every turn is a pure KV-cache append instead of
  a re-prefill. No tool-accuracy regression (Fase 0 benchmark: 98.9% tool /
  100% JSON).
- **Cold-start prefix session cache** (#20) — the KV state of the stable
  prompt prefix is saved to disk after the first clean turn and restored right
  after model load, cutting the first message from 37.3s to 2.8s. Keyed by
  model + settings + prefix text; any change invalidates it; a corrupted file
  self-heals into a normal cold start. Saves are debounced (llama.cpp
  serializes the full KV state, ~215 MB per file).
- **Performance settings** (#17) — user-tunable CPU threads, KV-cache q8_0
  quantization + flash attention (halves KV memory, ~1.5x slower on CPU), and
  mlock. All default OFF; the Settings hint states the trade-off.
- **Prefill benchmark dev command** (#20, #22) — `/benchmark-prefill` measures
  the three prompt layouts back-to-back on device via `timings.promptMs`.

### Fixed — Fase 4

- **Duplicate user message** (#22) — since Fase 1, the current user message
  reached the model twice (once in history, once appended). Fixed and locked
  by a history-stability test suite.
- **Memory extraction no longer evicts the chat KV cache** (#18) — it now
  appends to the conversation (sharing the cached prefix) instead of running
  as a standalone prompt, and its timeout can no longer cancel the user's next
  generation.

Fase 3 — Document Intelligence adds on-device RAG. Import a PDF, Word (.docx),
text, or Markdown file; Vesta extracts and chunks the text, embeds it with a
local Nomic model, and answers questions grounded in it via brute-force cosine
retrieval — all offline. Verified on a Pixel 10 Pro, PDF included.

### Added — Fase 3

- **`query_document` tool** — a read tool that runs through the orchestrator
  query loop: embed the question, cosine-rank the stored chunk vectors, and
  answer from the top matches. A relevance floor returns "nothing relevant"
  instead of confabulating when a question isn't covered by the documents.
- **Documents screen** — import PDF / DOCX / TXT / MD with per-chunk indexing
  progress, list, and delete. Parsing via `pdfjs` (PDF, with Hermes DOM
  polyfills), `jszip` (DOCX), and direct read (TXT/MD). No `sqlite-vec`
  dependency — vectors are brute-force cosine-scanned in TypeScript.
- **On-device embeddings** — a second `llama.rn` context runs the Nomic embed
  model alongside the chat model, and is reclaimed when the app backgrounds.

Fase 2 — Core Polish complete. All 10 core tools and the orchestrator query
loop are implemented and verified on real hardware (a Pixel 10 Pro): timers,
calendar read, and contact search run fully offline against real on-device
data, with calls/SMS gated behind explicit confirmation. See
[docs/GAMEPLAN.md](docs/GAMEPLAN.md).

### Added

- **Six more system tools**, completing the Fase 2 set: `set_timer`,
  `navigate_to` (#11); `search_contacts`, `make_call`, `send_sms`, and
  `get_calendar_events` (#13). All 10 tools work offline via native Android
  intents or `ContentResolver` queries, with destructive actions gated by an
  explicit confirmation step.
- **Orchestrator query loop** — read tools (`get_calendar_events`,
  `search_contacts`) execute inline, so questions like "che appuntamenti ho
  domani?" are answered in natural language from real on-device data.
- **Malformed-JSON recovery** — when the model emits an unparseable or truncated
  tool call, the orchestrator retries once with a correction prompt that asks
  for the JSON object only, then falls back to a plain reply if it still fails
  (the Fase 2 exit-gate requirement).
- **Honest tool-result messages** (#12) — `set_alarm` no longer claims a
  future date (Android arms only the next occurrence), and `create_event`
  reports that the calendar editor opened rather than falsely claiming the
  event was saved.
- **Cancellable memory extraction** (#12) — a background memory-extraction
  pass is now stopped when the user sends a new message, so a background LLM
  run never blocks the next turn; memory injection no longer self-reinforces
  the ranking.
- **Bilingual** IT/EN coverage extended to all 10 tools' prompts and
  confirmation messages.

## [0.1.0] — 2026-06-25

First public release — Fase 1 Android MVP. The core loop works end-to-end on
real hardware: load a model, chat, and trigger system actions fully offline.

### Added

- **On-device chat** with any GGUF model via [llama.rn](https://github.com/mybigday/llama.rn) (llama.cpp). Works in airplane mode.
- **In-app model manager** — curated, RAM-aware catalog with download (progress, resume, cancel); add any public HuggingFace GGUF repo; import a local `.gguf`; switch or delete the active model.
- **System actions** through native Android intents — set alarm, create calendar event, and schedule reminder (as a local notification), each gated by an explicit confirmation step.
- **Conversation memory** — personal facts extracted and stored locally in SQLite, injected into future prompts for continuity.
- **Knowledge files** — import `.md` / `.txt` files as portable, offline personal context.
- **Conversation history** — full persistence with SQLite: browse, switch, and delete past chats.
- **Home-screen widget** — 2×2 widget with a quick-chat bar and voice entry.
- **Foreground service** keeps the model resident in RAM between turns.
- **Bilingual** English and Italian system prompts.

### Notes

- Repetition penalty and a hardened Stop control were added after the first
  on-device test (a long free-text answer could otherwise loop, and Stop could
  throw on a JSI quirk in `llama.rn`).
- `ACTION_SET_ALARM` sets the next occurrence of a time; specific future-dated
  alarms are out of scope for the MVP. The tool result now states this honestly.
