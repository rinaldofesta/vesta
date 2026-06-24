# Changelog

All notable changes to Vesta are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Work in progress toward Fase 2. See [docs/GAMEPLAN.md](docs/GAMEPLAN.md)._

## [0.1.0] — 2026-06-24

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
  alarms are out of scope for the MVP.
