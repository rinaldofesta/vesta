# Vesta — Context Brief for Claude Code

**Paste this at the start of every Claude Code session working on Vesta.**

---

## What is Vesta

Vesta is an offline-first AI personal assistant that runs entirely on-device (Android phone/tablet, later iOS). Users interact via chat in natural language to execute system actions (alarms, calendar, reminders), query personal documents (RAG), and have conversations — all without internet.

**Tagline:** *Intelligence that never leaves home.*

**Named after:** the Roman goddess of the hearth — the sacred fire that never goes out.

---

## Core Architecture

```
React Native App (TypeScript)
  └─ Orchestrator (TypeScript, cross-platform)
      ├─ Tool Registry (declarative JSON schema)
      ├─ Router (message → LLM → JSON tool_call or text)
      └─ Conversation Manager (history, context)
          │
          ▼
Native Bridge (Kotlin for Android / Swift for iOS)
  ├─ LlamaCppModule — llama.cpp via NDK, OpenCL for Adreno GPU
  ├─ SystemActionsModule — Android Intents (alarm, calendar, etc.)
  └─ VestaService — Foreground Service, keeps model in RAM
          │
          ▼
Local Storage
  ├─ SQLite (messages, config, memories)
  ├─ sqlite-vec (document embeddings for RAG)
  └─ .gguf model files
```

**Optional:** Vesta Hearth (Mac Hub) — Node.js + Ollama + WebSocket on Mac, auto-discovered via mDNS on LAN. Delegates heavy queries to 70B model. Phone works 100% without it.

---

## Tech Stack

| Component | Technology | Why |
|---|---|---|
| App | React Native + Expo | Cross-platform, TS-native developer |
| LLM runtime | llama.cpp (NDK build) | Official Android binding, any GGUF model |
| Native bridge | Kotlin (Android) | Only for: llama.cpp, Intents, Foreground Service |
| Orchestrator | TypeScript | Cross-platform, developer's strong language |
| DB | SQLite (expo-sqlite) | Native, zero config |
| Vector DB | sqlite-vec | 100KB, no dependencies |
| Embedding | llama.cpp (nomic-embed-text) | Same runtime as LLM |
| Mac Hub | Node.js + Ollama + ws | Optional boost |

---

## Models

| Model | Role | RAM | Speed |
|---|---|---|---|
| Qwen3 4B (Q4_K_M) | Primary on phone | ~3 GB | ~15-25 tok/s |
| Qwen3 8B (Q4_K_M) | Primary on tablet | ~5.5 GB | ~10-18 tok/s |
| FunctionGemma 270M | Fast router (optional) | ~0.2 GB | ~100+ tok/s |
| nomic-embed-text | Embedding for RAG | ~0.3 GB | batch mode |
| Llama 3.1 70B (Q6) | Mac Hub workhorse | ~55 GB | ~15-22 tok/s |

---

## Tool System (MVP: 4 tools)

Tools are declared as JSON schemas injected into the system prompt. When the LLM recognizes an action request, it outputs structured JSON instead of text.

```typescript
// MVP tools (Fase 1):
set_alarm:       { time: "HH:MM", date?: "YYYY-MM-DD", label?: string }
create_event:    { title: string, start: "ISO8601", end?: "ISO8601", location?: string }
set_reminder:    { text: string, datetime: "ISO8601" }
general_chat:    {} // no action, just text response

// Fase 2 additions:
make_call:       { contact: string }
send_sms:        { contact: string, text: string }
set_timer:       { minutes: number, label?: string }
navigate_to:     { destination: string }
get_calendar_events: { date: "YYYY-MM-DD" }
search_contacts: { query: string }
```

Android implementation: each tool maps to a standard Android Intent or ContentResolver query. No Accessibility Service, no root, no special permissions beyond standard (SET_ALARM, READ_CALENDAR, etc.).

---

## Languages

English + Italian from day 1. The system prompt, benchmark dataset, and confirmation messages must work in both. Qwen3 4B supports 100+ languages natively. Spanish, French, German, Portuguese added at month 3-6.

---

## Current Phase

Check GAMEPLAN.md for current phase and exit gate.

---

## Key Constraints

- **Offline-first**: every feature MUST work without internet. Mac Hub is optional boost.
- **Single LLM runtime**: llama.cpp for inference AND embedding. No ONNX, no MLC, no second runtime.
- **Minimal native**: Kotlin/C++ ONLY for llama.cpp bridge, Android Intents, Foreground Service. Everything else in TypeScript.
- **MVP mindset**: don't build features not in the current phase. Check GAMEPLAN.md for what's in scope.

---

## Repository Structure

```
vesta/
├── apps/
│   ├── mobile/                    # React Native + Expo
│   │   ├── app/                   # Screens (Expo Router)
│   │   ├── components/            # Reusable UI components
│   │   ├── lib/
│   │   │   ├── orchestrator/      # Core brain (TS)
│   │   │   ├── tools/             # Tool definitions (TS)
│   │   │   └── storage/           # SQLite wrapper (TS)
│   │   └── native/
│   │       └── android/           # Kotlin: LlamaCppModule, SystemActionsModule, VestaService
│   └── mac-hub/                   # Node.js server (Fase 4)
├── scripts/
│   └── benchmark/                 # Fase 0 benchmark
├── docs/
│   ├── PRD.md                     # Product requirements
│   ├── ARCHITECTURE.md            # System architecture
│   ├── SPEC.md                    # Technical specifications
│   ├── GAMEPLAN.md                # Operational playbook with exit gates
│   └── CLAUDE-CODE-BRIEF.md       # This file
└── package.json
```

---

## SQLite Schema (MVP)

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool_result')),
  content TEXT NOT NULL,
  tool_call TEXT,          -- JSON if tool was called
  tool_result TEXT,        -- JSON result from tool execution
  model_used TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO config VALUES ('model_primary', 'qwen3-4b-q4_k_m.gguf');
INSERT INTO config VALUES ('language', 'it');
INSERT INTO config VALUES ('confirm_destructive_actions', 'true');
```

That's it for MVP. More tables (documents, memories, scheduled_tasks) are added in later phases per SPEC.md.

---

## System Prompt Template

```
You are Vesta, a personal assistant running locally on the user's device.
You respond in {{language}}.
Current date and time: {{datetime}} ({{timezone}})

When the user asks you to perform an action, respond ONLY with valid JSON:
{
  "tool": "tool_name",
  "parameters": { ... },
  "message": "Confirmation message for the user"
}

When the user asks a question or wants to chat, respond normally in text.

RULES:
- Times must be in HH:MM format (e.g., "07:30")
- Dates must be in ISO 8601 format (e.g., "2026-03-12T15:00:00")
- "Tomorrow" means {{tomorrow_date}}
- "Tonight" means today between 18:00 and 23:00
- If a parameter is ambiguous, ask the user for clarification
- Never make up information you don't have

Available tools:

{{tool_schemas}}

If the request doesn't match any tool, respond as general conversation.
```

---

## Reference Docs

For full details, read:
- `docs/PRD.md` — Product vision, user stories, success metrics
- `docs/ARCHITECTURE.md` — System design, data flows, ADRs
- `docs/SPEC.md` — Database schemas, tool schemas, native module interfaces
- `docs/GAMEPLAN.md` — Phase-by-phase plan with exit gates
