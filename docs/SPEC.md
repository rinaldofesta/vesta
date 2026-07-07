# Vesta — Technical Specifications (SPEC)

**Version:** 2.1
**Data:** 7 Luglio 2026 (design originale: 8 Marzo 2026)
**Autore:** Cosmico Engineering
**Status:** Living document — sezioni implementate allineate al codice (Fase 0–4)
**Tagline:** *Intelligence that never leaves home.*

---

## 1. Struttura Repository

```
vesta/
├── apps/
│   ├── mobile/                    # React Native + Expo
│   │   ├── app/                   # Schermate (Expo Router): chat, history, models, documents, settings
│   │   ├── components/            # Componenti UI riutilizzabili
│   │   ├── lib/                   # Logica cross-platform (TS)
│   │   │   ├── orchestrator/      # Core brain: prompt builder (V4), parser, dispatcher, memorie, retriever
│   │   │   ├── llm/               # Wrapper llama.rn: chat engine, embed engine, perf config, session cache
│   │   │   ├── tools/             # Tool definitions + confirmation gate
│   │   │   ├── documents/         # Pipeline RAG: parser, chunker, cosine similarity
│   │   │   ├── models/            # Catalogo curato + download manager + registry
│   │   │   ├── native/            # Bridge TS verso i moduli Kotlin + reminders (expo-notifications)
│   │   │   ├── storage/           # SQLite (expo-sqlite) + migrazioni
│   │   │   └── store/             # Stato Zustand
│   │   ├── native/
│   │   │   └── android/           # Kotlin: SystemActions, VestaService, widget, voice activity
│   │   ├── plugins/               # Config plugin Expo (copia/registra il codice nativo al prebuild)
│   │   └── assets/
│   │
│   └── mac-hub/                   # Node.js server (parcheggiato — non ancora creato)
│
├── scripts/
│   └── benchmark/                 # Benchmark Fase 0 (run.ts, prompts JSONL, system prompt sync-copy, archive/)
│
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md            # Include gli ADR (§7)
│   ├── SPEC.md                    # Questo file
│   ├── GAMEPLAN.md
│   └── FASE0-RESULTS.md
│
├── package.json                   # Root workspace
└── README.md
```

> L'inferenza llama.cpp arriva via **llama.rn** (dipendenza npm) — non esiste un
> bridge NDK scritto in casa. Il Kotlin è limitato a Intents, Foreground Service,
> widget e voce (ADR-002/006).

---

## 2. Schema Database

### 2.1 SQLite Principale (vesta.db)

> **Stato implementazione**: le tabelle attive sono `conversations`, `messages`,
> `memories`, `knowledge_files`, `config` (baseline) + `models` (migrazione v1) +
> `documents`/`chunks` (migrazione v2, vedi §2.2). Migrazioni via `PRAGMA
> user_version` con array `MIGRATIONS` applicato in transazione atomica
> (`lib/storage/database.ts`). `scheduled_tasks` qui sotto è design per una fase
> futura — non ancora creata.

```sql
-- ============================================================
-- CONVERSAZIONI
-- ============================================================

CREATE TABLE conversations (
  id            TEXT PRIMARY KEY,          -- UUID v4
  title         TEXT,                       -- Generato dal primo messaggio
  created_at    INTEGER NOT NULL,          -- Unix timestamp ms
  updated_at    INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  is_archived   INTEGER DEFAULT 0          -- 0=attiva, 1=archiviata
);

CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);

-- ============================================================
-- MESSAGGI
-- ============================================================

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,        -- UUID v4
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool_result')),
  content         TEXT NOT NULL,           -- Testo del messaggio
  tool_call       TEXT,                     -- JSON: { tool, parameters } se presente
  tool_result     TEXT,                     -- JSON: { success, data, message } se presente
  model_used      TEXT,                     -- es. "qwen3-4b-instruct-2507-q4_k_m"
  tokens_in       INTEGER,                 -- Token di input consumati
  tokens_out      INTEGER,                 -- Token generati
  latency_ms      INTEGER,                 -- Tempo totale di generazione
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);

-- ============================================================
-- MEMORIE UTENTE (fatti a lungo termine)
-- ============================================================

CREATE TABLE memories (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL CHECK(category IN (
    'preference',     -- "preferisce la sveglia alle 7"
    'fact',           -- "lavora a Roma"
    'routine',        -- "il lunedì ha riunione alle 9"
    'contact_note',   -- "Marco è il dentista"
    'topic_interest'  -- "sta studiando la Rivoluzione Francese"
  )),
  content     TEXT NOT NULL,             -- Descrizione in linguaggio naturale
  source_message_id TEXT REFERENCES messages(id),
  confidence  REAL DEFAULT 1.0,          -- 0.0-1.0, decade nel tempo
  access_count INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL,
  last_accessed INTEGER
);

CREATE INDEX idx_memories_category ON memories(category);

-- ============================================================
-- DOCUMENTI
-- ============================================================

CREATE TABLE documents (
  id          TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  file_path   TEXT NOT NULL,             -- Path locale nel device
  file_type   TEXT NOT NULL,             -- 'pdf', 'docx', 'txt', 'md', 'epub'
  file_size   INTEGER,                   -- Bytes
  chunk_count INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'ready', 'error')),
  error       TEXT,
  created_at  INTEGER NOT NULL
);

-- ============================================================
-- TASK SCHEDULATI
-- ============================================================

CREATE TABLE scheduled_tasks (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK(type IN ('cron', 'once', 'interval')),
  schedule        TEXT NOT NULL,         -- Cron expression o ISO datetime o interval ms
  tool_name       TEXT NOT NULL,
  parameters      TEXT NOT NULL,         -- JSON
  description     TEXT,                  -- Leggibile umano
  last_run        INTEGER,
  next_run        INTEGER,
  run_count       INTEGER DEFAULT 0,
  is_active       INTEGER DEFAULT 1,
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_tasks_next ON scheduled_tasks(next_run) WHERE is_active = 1;

-- ============================================================
-- CONFIGURAZIONE
-- ============================================================

CREATE TABLE config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Valori di default (seed effettivi in lib/storage/database.ts)
INSERT INTO config VALUES ('language', 'it');
INSERT INTO config VALUES ('confirm_destructive_actions', 'true');

-- Mai implementati (design marzo 2026): 'model_classifier' (cascata scartata,
-- ADR-007), 'model_idle_timeout_ms' (nessun auto-unload, ADR-015),
-- 'hub_enabled'/'hub_auto_connect' (Mac Hub parcheggiato, ADR-010).
-- Il modello attivo vive nella tabella `models` (is_active), non in config.
```

### 2.2 Vettori RAG (stessa vesta.db — NIENTE sqlite-vec)

> Il design originale prevedeva sqlite-vec (tabella virtuale `vec0`, HNSW).
> **Mai implementato**: expo-sqlite non può caricare estensioni native (ADR-008).
> Gli embedding sono BLOB float32 nella tabella `chunks`; il retrieval è una
> scansione brute-force con cosine similarity in TypeScript
> (`lib/documents/similarity.ts` + `lib/orchestrator/document-retriever.ts`).

Schema reale (migrazione v2, `lib/storage/database.ts`):

```sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER DEFAULT 0,
  chunk_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER DEFAULT 0,
  embedding BLOB,                      -- float32 raw bytes, L2-normalized (768 dim)
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
```

La "query semantica" è codice TS, non SQL: si caricano gli embedding dei chunk,
si calcola il dot product con l'embedding della query (entrambi L2-normalized →
cosine), si tengono i top-K sopra la soglia di rilevanza 0.28.

---

## 3. Tool System

### 3.1 Definizione Tool (Schema Dichiarativo)

Ogni tool è definito come un oggetto TypeScript immutabile. Lo schema viene serializzato e iniettato nel system prompt del modello.

```typescript
// packages/shared/tool-schema.ts

export interface ToolDefinition {
  name: string;
  description: string;                    // In italiano — il modello lo legge
  category: 'system_action' | 'knowledge' | 'utility';
  parameters: {
    type: 'object';
    properties: Record<string, ParameterDef>;
    required: string[];
  };
  confirmRequired: boolean;               // Chiede conferma all'utente?
  offlineCapable: boolean;
  platforms: ('android' | 'ios' | 'mac')[];
}

export interface ParameterDef {
  type: 'string' | 'number' | 'boolean';
  description: string;                    // In italiano
  format?: string;                        // es. 'time-HH:MM', 'date-ISO', 'phone'
  enum?: string[];
}
```

### 3.2 Catalogo Tool V1

```typescript
export const TOOLS_V1: ToolDefinition[] = [

  // ── SYSTEM ACTIONS ──────────────────────────────────────────
  {
    name: "set_alarm",
    description: "Imposta una sveglia o una suoneria ad un orario specifico",
    category: "system_action",
    parameters: {
      type: "object",
      properties: {
        time:  { type: "string", description: "Orario della sveglia", format: "time-HH:MM" },
        date:  { type: "string", description: "Data (se diversa da oggi)", format: "date-ISO" },
        label: { type: "string", description: "Etichetta della sveglia" }
      },
      required: ["time"]
    },
    confirmRequired: false,
    offlineCapable: true,
    platforms: ["android", "ios"]
  },

  {
    name: "create_event",
    description: "Crea un evento o appuntamento nel calendario",
    category: "system_action",
    parameters: {
      type: "object",
      properties: {
        title:    { type: "string", description: "Titolo dell'evento" },
        start:    { type: "string", description: "Data e ora di inizio", format: "datetime-ISO" },
        end:      { type: "string", description: "Data e ora di fine", format: "datetime-ISO" },
        location: { type: "string", description: "Luogo dell'evento" },
        notes:    { type: "string", description: "Note aggiuntive" }
      },
      required: ["title", "start"]
    },
    confirmRequired: false,
    offlineCapable: true,
    platforms: ["android", "ios"]
  },

  {
    name: "set_reminder",
    description: "Crea un promemoria con notifica ad un certo orario",
    category: "system_action",
    parameters: {
      type: "object",
      properties: {
        text:     { type: "string", description: "Testo del promemoria" },
        datetime: { type: "string", description: "Quando ricordare", format: "datetime-ISO" }
      },
      required: ["text", "datetime"]
    },
    confirmRequired: false,
    offlineCapable: true,
    platforms: ["android", "ios"]
  },

  {
    name: "make_call",
    description: "Avvia una telefonata ad un contatto o numero",
    category: "system_action",
    parameters: {
      type: "object",
      properties: {
        contact: { type: "string", description: "Nome del contatto o numero di telefono" }
      },
      required: ["contact"]
    },
    confirmRequired: true,
    offlineCapable: true,
    platforms: ["android", "ios"]
  },

  {
    name: "send_sms",
    description: "Invia un messaggio SMS ad un contatto",
    category: "system_action",
    parameters: {
      type: "object",
      properties: {
        contact: { type: "string", description: "Nome del contatto o numero" },
        text:    { type: "string", description: "Testo del messaggio" }
      },
      required: ["contact", "text"]
    },
    confirmRequired: true,
    offlineCapable: true,
    platforms: ["android", "ios"]
  },

  {
    name: "navigate_to",
    description: "Apri la navigazione verso un indirizzo o luogo",
    category: "system_action",
    parameters: {
      type: "object",
      properties: {
        destination: { type: "string", description: "Indirizzo o nome del luogo" }
      },
      required: ["destination"]
    },
    confirmRequired: false,
    offlineCapable: false,
    platforms: ["android", "ios"]
  },

  {
    name: "set_timer",
    description: "Avvia un timer per un certo numero di minuti",
    category: "system_action",
    parameters: {
      type: "object",
      properties: {
        minutes: { type: "number", description: "Durata in minuti" },
        label:   { type: "string", description: "Nome del timer" }
      },
      required: ["minutes"]
    },
    confirmRequired: false,
    offlineCapable: true,
    platforms: ["android", "ios"]
  },

  // ── KNOWLEDGE ───────────────────────────────────────────────
  {
    name: "query_document",
    description: "Cerca informazioni nei documenti caricati dall'utente",
    category: "knowledge",
    parameters: {
      type: "object",
      properties: {
        question:      { type: "string", description: "Domanda da cercare nei documenti" },
        document_name: { type: "string", description: "Nome specifico del documento (opzionale)" }
      },
      required: ["question"]
    },
    confirmRequired: false,
    offlineCapable: true,
    platforms: ["android", "ios", "mac"]
  },

  {
    name: "get_calendar_events",
    description: "Leggi gli eventi dal calendario per una data specifica",
    category: "knowledge",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Data da consultare", format: "date-ISO" }
      },
      required: ["date"]
    },
    confirmRequired: false,
    offlineCapable: true,
    platforms: ["android", "ios"]
  },

  {
    name: "search_contacts",
    description: "Cerca un contatto nella rubrica per nome",
    category: "knowledge",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Nome o parte del nome da cercare" }
      },
      required: ["query"]
    },
    confirmRequired: false,
    offlineCapable: true,
    platforms: ["android", "ios"]
  },

  // ── UTILITY ─────────────────────────────────────────────────
  {
    name: "general_chat",
    description: "Rispondi a una domanda generica, una conversazione, o una richiesta creativa",
    category: "utility",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    confirmRequired: false,
    offlineCapable: true,
    platforms: ["android", "ios", "mac"]
  }
];
```

### 3.3 System Prompt Template

> **Nota (Fase 4, V4):** la struttura del prompt è cambiata — la fonte di verità è
> `apps/mobile/lib/orchestrator/prompt-builder.ts`. Il system prompt è
> completamente STATICO (persona + formato + regole + tool schema +
> memorie/knowledge, byte-identico tra i turni); il contesto data/ora viaggia in
> una riga `[Contesto temporale: ...]` anteposta a OGNI messaggio utente
> (`buildTurnContext`/`annotateUserMessage`), con precisione al minuto. I turni
> storici la rendono dal `createdAt` salvato del messaggio, quindi la storia
> replayata è byte-identica per sempre e ogni turno è un puro append nella KV
> cache di llama.rn. Mai interpolare data/ora nel system prompt.

```typescript
// lib/orchestrator/prompt-builder.ts (sketch)

// SYSTEM PROMPT — completamente statico, niente data/ora
export function buildStablePrefix(lang, memoriesBlock?, knowledgeBlock?): string {
  return `Sei Vesta, un assistente personale locale. Rispondi in ${lang}.

Quando l'utente chiede di eseguire un'azione, rispondi ESCLUSIVAMENTE con un JSON valido:
{ "tool": "...", "parameters": { ... }, "message": "..." }

REGOLE:
- I messaggi dell'utente iniziano con una riga [Contesto temporale: ...]; usala per interpretare date e orari, non citarla
- Le date in ISO 8601 "YYYY-MM-DDTHH:MM:SS"; ricava la data dal [Contesto temporale: ...] del messaggio PIÙ RECENTE
- ... (regole di routing e default orari)

Strumenti disponibili:
${toolsBlock}
${memoriesSection}${knowledgeSection}`;
}

// CONTESTO PER TURNO — funzione pura di (lang, at); la storia si rende dal
// createdAt del messaggio, il turno corrente dal suo timestamp di invio
export function buildTurnContext(lang, at: Date): string {
  return `[Contesto temporale: ${dayOfWeek} ${datetimeMinuti} (${timezone}). Oggi: ${today}. Domani: ${tomorrow}]`;
}
export function annotateUserMessage(lang, at, text) {
  return `${buildTurnContext(lang, at)}\n${text}`;
}
```

---

## 4. Pipeline RAG (Document Intelligence)

### 4.1 Ingestion Pipeline

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  File Picker  │────►│  Parser      │────►│  Chunker     │
│  (expo-doc)   │     │  (per tipo)  │     │  (overlap)   │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                          ┌───────▼───────┐
                                          │  Embedder     │
                                          │  (2° contesto │
                                          │   llama.rn,   │
                                          │   nomic-embed)│
                                          └───────┬───────┘
                                                  │
                                     ┌────────────▼────────────┐
                                     │  SQLite (vesta.db)      │
                                     │  documents + chunks     │
                                     │  (embedding BLOB f32)   │
                                     └─────────────────────────┘
```

### 4.2 Specifiche Chunking

```typescript
// lib/rag/chunker.ts

export interface ChunkOptions {
  maxTokens: number;        // Default: 512
  overlapTokens: number;    // Default: 64 (12.5% overlap)
  respectParagraphs: boolean; // Default: true
  respectSentences: boolean;  // Default: true
}

// Algoritmo:
// 1. Splitta per paragrafi (doppio newline)
// 2. Se paragrafo > maxTokens, splitta per frasi
// 3. Se frase > maxTokens, splitta per token (raro)
// 4. Aggrega chunk fino a maxTokens
// 5. Aggiungi overlap: ultimi overlapTokens del chunk precedente
```

### 4.3 Specifiche Embedding

```typescript
// lib/llm/embed-engine.ts

// Modello: nomic-embed-text-v1.5 (137M params, GGUF)
// Dimensioni output: 768
// Formato: Float32Array → salvato come BLOB float32
// Normalizzazione: L2 (cosine similarity via dot product)
// Runtime: SECONDO contesto llama.rn accanto al modello chat;
// rilasciato quando l'app va in background, ricaricato lazy.

export interface EmbedderConfig {
  model: string;           // "nomic-embed-text-v1.5.Q8_0.gguf"
  dimensions: 768;
  prefix: {
    query: "search_query: ";    // Prefisso per query
    document: "search_document: "; // Prefisso per documenti
  };
}
```

### 4.4 Retrieval

```typescript
// lib/orchestrator/document-retriever.ts

export interface RetrievalOptions {
  query: string;
  maxChunks: number;              // Default: 5
  minSimilarity: number;          // 0.28 — soglia di rilevanza (MIN_SCORE)
}

// Algoritmo (implementato):
// 1. Embed query con prefisso "search_query: " (2° contesto llama.rn)
// 2. Scansione brute-force: cosine (dot product, vettori L2-normalized)
//    su tutti gli embedding BLOB della tabella chunks — in TypeScript
// 3. Soglia di rilevanza: se anche il best match è < 0.28, si risponde
//    "niente di rilevante" invece di iniettare chunk fuori tema
// 4. Ritorna top K chunk (testo + documento di provenienza); il query loop
//    li re-inietta come tool result per la risposta groundata
// (MMR/diversificazione: design futuro, non implementato)
```

---

## 5. Specifiche Native Module Android

### 5.1 LLM Engine — llama.rn (nessun modulo Kotlin in casa)

> Il design originale prevedeva un `LlamaCppModule` Kotlin+JNI scritto in casa.
> **Sostituito da llama.rn** (binding React Native ufficiale di llama.cpp,
> ADR-006): il modulo nativo arriva come dipendenza npm, il nostro codice è il
> wrapper TypeScript.

```typescript
// lib/llm/llm-engine.ts — contesto CHAT

loadModel(path, perfConfig)   // → initLlama({ model, n_ctx, n_threads,
                              //     cache_type_k/v, flash_attn_type, use_mlock })
generate(messages, onToken)   // → context.completion({ messages, n_predict,
                              //     penalty_repeat, ... }) — streaming via TokenData;
                              //     NIENTE grammar: JSON via prompt + retry (§3.4)
stopGeneration()              // → stopCompletion() (con guardia stoppedByUser)
snapshotPrefixSession(...)    // → saveSession: prefix KV cache su disco
loadSessionFile(path)         // → loadSession: restore al boot, prima di ogni completion
clearKvCache() / getModelInfo() / unloadModel()

// lib/llm/embed-engine.ts — contesto EMBEDDING (secondo contesto llama.rn)
embed(text)                   // → Float32Array L2-normalized (768 dim)
unloadEmbeddingModel()        // rilasciato su AppState background, reload lazy

// lib/llm/perf-config.ts — settings utente (default OFF):
// CPU threads, KV cache q8_0 + flash attention, mlock
```

### 5.2 SystemActionsModule (Kotlin)

```kotlin
// native/android/SystemActionsModule.kt

@ReactModule(name = "SystemActionsModule")
class SystemActionsModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  @ReactMethod
  fun setAlarm(time: String, date: String?, label: String?, promise: Promise) {
    val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
      putExtra(AlarmClock.EXTRA_HOUR, time.split(":")[0].toInt())
      putExtra(AlarmClock.EXTRA_MINUTES, time.split(":")[1].toInt())
      label?.let { putExtra(AlarmClock.EXTRA_MESSAGE, it) }
      putExtra(AlarmClock.EXTRA_SKIP_UI, true)
    }
    currentActivity?.startActivity(intent)
    promise.resolve(mapOf("success" to true, "message" to "Sveglia impostata"))
  }

  @ReactMethod
  fun createEvent(title: String, start: String, end: String?, location: String?, notes: String?, promise: Promise)

  @ReactMethod
  fun setReminder(text: String, datetime: String, promise: Promise)

  @ReactMethod
  fun makeCall(contactOrNumber: String, promise: Promise)

  @ReactMethod
  fun sendSMS(contactOrNumber: String, text: String, promise: Promise)

  @ReactMethod
  fun navigateTo(destination: String, promise: Promise)

  @ReactMethod
  fun setTimer(minutes: Int, label: String?, promise: Promise)

  @ReactMethod
  fun getCalendarEvents(date: String, promise: Promise)
  // Ritorna: [{ id, title, start, end, location }]

  @ReactMethod
  fun searchContacts(query: String, promise: Promise)
  // Ritorna: [{ id, name, phones: [], emails: [] }]
}
```

### 5.3 ForegroundServiceModule (Kotlin)

```kotlin
// native/android/VestaService.kt

class VestaService : Service() {
  private val NOTIFICATION_ID = 1
  private val CHANNEL_ID = "vesta_service"

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    createNotificationChannel()
    val notification = buildNotification("Modello pronto")
    startForeground(NOTIFICATION_ID, notification)
    return START_STICKY  // Riavvia se ucciso dal sistema
  }

  fun updateStatus(status: String) {
    val notification = buildNotification(status)
    val manager = getSystemService(NotificationManager::class.java)
    manager.notify(NOTIFICATION_ID, notification)
  }
}
```

---

## 6. Specifiche Fase 0: Benchmark Function Calling

### 6.1 Dataset

File `scripts/benchmark/prompts_it.jsonl`, minimo 100 entry:

```jsonl
{"id":"001","input":"svegliami domani alle 7 e mezza","expected_tool":"set_alarm","expected_params":{"time":"07:30"},"category":"alarm","difficulty":"easy"}
{"id":"002","input":"metti la sveglia per le 6:45","expected_tool":"set_alarm","expected_params":{"time":"06:45"},"category":"alarm","difficulty":"easy"}
{"id":"003","input":"svejami presto domattina","expected_tool":"set_alarm","expected_params":{},"category":"alarm","difficulty":"ambiguous"}
{"id":"004","input":"ho un appuntamento dal dentista giovedì prossimo alle 15","expected_tool":"create_event","expected_params":{"title":"Dentista"},"category":"calendar","difficulty":"medium"}
{"id":"005","input":"fissa riunione con Marco lunedì alle 10 in ufficio","expected_tool":"create_event","expected_params":{"title":"Riunione con Marco","location":"ufficio"},"category":"calendar","difficulty":"medium"}
{"id":"006","input":"ricordami di comprare il latte stasera","expected_tool":"set_reminder","expected_params":{"text":"comprare il latte"},"category":"reminder","difficulty":"medium"}
{"id":"007","input":"chiama Marco","expected_tool":"make_call","expected_params":{"contact":"Marco"},"category":"call","difficulty":"easy"}
{"id":"008","input":"scrivi a Laura che arrivo tra 10 minuti","expected_tool":"send_sms","expected_params":{"contact":"Laura","text":"arrivo tra 10 minuti"},"category":"sms","difficulty":"medium"}
{"id":"009","input":"portami al Colosseo","expected_tool":"navigate_to","expected_params":{"destination":"Colosseo"},"category":"navigation","difficulty":"easy"}
{"id":"010","input":"che appuntamenti ho domani?","expected_tool":"get_calendar_events","expected_params":{},"category":"calendar_read","difficulty":"easy"}
{"id":"011","input":"qual è la ricetta della carbonara?","expected_tool":"general_chat","expected_params":{},"category":"chat","difficulty":"easy"}
{"id":"012","input":"chi era Napoleone?","expected_tool":"general_chat","expected_params":{},"category":"chat","difficulty":"easy"}
{"id":"013","input":"metti un timer di 5 minuti per la pasta","expected_tool":"set_timer","expected_params":{"minutes":5,"label":"pasta"},"category":"timer","difficulty":"easy"}
{"id":"014","input":"trova il numero di telefono di Laura Rossi","expected_tool":"search_contacts","expected_params":{"query":"Laura Rossi"},"category":"contacts","difficulty":"easy"}
```

### 6.2 Script di Benchmark

```typescript
// scripts/benchmark/run-fc-benchmark.ts

interface BenchmarkResult {
  model: string;
  promptId: string;
  input: string;
  expected: { tool: string; params: Record<string, any> };
  actual: { tool: string; params: Record<string, any> } | null;
  jsonValid: boolean;
  toolCorrect: boolean;
  paramsCorrect: boolean;
  latencyMs: number;
  error?: string;
}

// Per ogni modello:
//   Per ogni prompt:
//     1. Invia prompt con system prompt + tool schema a Ollama
//     2. Parsa risposta
//     3. Confronta tool e parametri con expected
//     4. Registra risultato

// Output: CSV con colonne:
// model, prompt_id, category, difficulty, json_valid, tool_correct, params_correct, latency_ms, error
```

### 6.3 Metriche da Raccogliere

```
Per ogni modello, calcola:

1. JSON Validity Rate        = % risposte che sono JSON valido
2. Tool Accuracy             = % tool correttamente identificati
3. Parameter Accuracy        = % parametri correttamente estratti
4. Composite Score           = (0.3 * JSON + 0.4 * Tool + 0.3 * Params)
5. Median Latency            = Mediana tempo di risposta
6. P95 Latency               = 95° percentile tempo di risposta

Breakdown per:
- Categoria (alarm, calendar, chat, ...)
- Difficoltà (easy, medium, ambiguous)
- Lingua (formale vs colloquiale)

Soglie di accettazione:
- JSON Validity:    ≥ 98%
- Tool Accuracy:    ≥ 95% (easy), ≥ 85% (medium), ≥ 70% (ambiguous)
- Parameter Acc:    ≥ 90% (easy), ≥ 80% (medium)
- Median Latency:   ≤ 2000ms (su Ollama Mac, indicativo)
```

---

## 7. Specifiche Mac Hub

> ⏸️ **Parcheggiato (re-scope Android-first):** il Mac Hub è in pausa — vedi GAMEPLAN.md. Le specifiche restano come riferimento per la ripresa futura.

### 7.1 Server

```typescript
// apps/mac-hub/src/server.ts

// Dipendenze: express, ws, mdns (bonjour), ollama

const HUB_PORT = 8420;
const SERVICE_TYPE = '_vesta._tcp';

// mDNS Advertisement
mdns.createAdvertisement(mdns.tcp('vesta'), HUB_PORT, {
  txtRecord: {
    version: '1.0',
    models: 'llama3.1:70b,qwen3:235b-a22b'
  }
});

// WebSocket Server
const wss = new WebSocket.Server({ port: HUB_PORT });

wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    const msg = JSON.parse(raw.toString());

    switch (msg.type) {
      case 'chat':
        // Streaming response via Ollama
        const stream = await ollama.chat({
          model: 'llama3.1:70b',
          messages: msg.context.history,
          stream: true
        });
        ws.send(JSON.stringify({ type: 'stream_start', conversationId: msg.conversationId }));
        for await (const chunk of stream) {
          ws.send(JSON.stringify({ type: 'stream_chunk', token: chunk.message.content }));
        }
        ws.send(JSON.stringify({ type: 'stream_end', conversationId: msg.conversationId }));
        break;

      case 'embed':
        const result = await ollama.embeddings({ model: 'nomic-embed-text', prompt: msg.text });
        ws.send(JSON.stringify({ type: 'embed_result', vector: result.embedding }));
        break;

      case 'ping':
        const models = await ollama.list();
        ws.send(JSON.stringify({
          type: 'pong',
          models: models.models.map(m => m.name)
        }));
        break;
    }
  });
});
```

---

## 8. Convenzioni di Sviluppo

### 8.1 Naming

- File: `kebab-case.ts` (es. `tool-registry.ts`)
- Componenti React: `PascalCase.tsx` (es. `ChatBubble.tsx`)
- Variabili/funzioni: `camelCase`
- Costanti: `UPPER_SNAKE_CASE`
- Tipi/Interfacce: `PascalCase` (es. `ToolDefinition`)
- Tool names: `snake_case` (es. `set_alarm`, `create_event`)

### 8.2 Error Handling

Ogni operazione che può fallire ritorna un tipo `Result`:

```typescript
type Result<T> = 
  | { success: true; data: T }
  | { success: false; error: string; code: ErrorCode };

enum ErrorCode {
  MODEL_NOT_LOADED = 'MODEL_NOT_LOADED',
  JSON_PARSE_ERROR = 'JSON_PARSE_ERROR',
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  INTENT_FAILED = 'INTENT_FAILED',
  EMBEDDING_FAILED = 'EMBEDDING_FAILED',
  DOCUMENT_PARSE_ERROR = 'DOCUMENT_PARSE_ERROR',
  HUB_CONNECTION_FAILED = 'HUB_CONNECTION_FAILED',
  OUT_OF_MEMORY = 'OUT_OF_MEMORY',
}
```

### 8.3 Testing

- **Fase 0**: benchmark automatizzati su function calling (test empirici sul modello)
- **Unit test**: per orchestrator, router, tool-dispatcher, parser (vitest)
- **Integration test**: per native modules (Kotlin test su Android, XCTest su iOS futuro)
- **E2E test**: per flussi completi (Detox per React Native)

### 8.4 Logging

```typescript
// Livelli: DEBUG, INFO, WARN, ERROR
// In produzione: solo WARN e ERROR
// In development: tutti

log.info('orchestrator', 'Tool call', { tool: 'set_alarm', params: { time: '07:30' } });
log.warn('llm', 'JSON parse retry', { attempt: 2, error: 'unexpected token' });
log.error('native', 'Intent failed', { intent: 'ACTION_SET_ALARM', error: '...' });

// I log vengono salvati in SQLite (tabella logs) e sono esportabili dall'utente
// per debugging. MAI loggare contenuto dei messaggi in produzione.
```

---

## 9. Dipendenze

### 9.1 Mobile (React Native)

```json
{
  "dependencies": {
    "expo": "~52",
    "react-native": "0.77",
    "expo-router": "~4",
    "expo-sqlite": "~15",
    "expo-document-picker": "~13",
    "expo-file-system": "~18",
    "expo-notifications": "~1",
    "expo-speech": "~13",
    "zustand": "^5",
    "uuid": "^11"
  },
  "devDependencies": {
    "typescript": "~5.6",
    "jest": "jest-expo preset (20+ suite in lib/**/__tests__)"
  }
}
```

**Native dependencies**:
- `llama.rn` (npm — compila llama.cpp per arm64 via NDK durante il build Android)
- Nessuna estensione SQLite (sqlite-vec scartato, ADR-008)

### 9.2 Mac Hub (parcheggiato)

```json
{
  "dependencies": {
    "express": "^5",
    "ws": "^8",
    "mdns": "^2",
    "ollama": "^1",
    "better-sqlite3": "^11"
  }
}
```

---

## 10. Checklist Pre-Sviluppo

Prima di scrivere codice, verifica di avere:

- [ ] Ollama installato e funzionante sul Mac
- [ ] Modelli scaricati: `qwen3:4b`, `qwen3:8b`, `gemma3:4b`, `llama3.2:3b`
- [ ] Android Studio installato con Android NDK (per compilazione llama.cpp)
- [ ] Device Android fisico per testing (almeno 8GB RAM, Snapdragon 8 Gen 2+)
- [ ] Node.js 18+ e npm installati (install con `--legacy-peer-deps`, vedi CONTRIBUTING.md)
- [ ] Expo CLI installato (`npx expo`)
- [ ] Dataset `prompts_it.jsonl` completato (minimo 100 entry)
- [ ] Script benchmark funzionante e testato su almeno un modello
- [ ] Risultati benchmark analizzati e modello primario scelto
