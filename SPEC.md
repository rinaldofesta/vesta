# Vesta — Technical Specifications (SPEC)

**Version:** 2.0  
**Data:** 8 Marzo 2026  
**Autore:** Cosmico Engineering  
**Status:** Final Draft  
**Tagline:** *Intelligence that never leaves home.*

---

## 1. Struttura Repository

```
vesta/
├── apps/
│   ├── mobile/                    # React Native + Expo
│   │   ├── app/                   # Schermate (Expo Router)
│   │   ├── components/            # Componenti UI riutilizzabili
│   │   ├── lib/                   # Logica cross-platform
│   │   │   ├── orchestrator/      # Core brain (TS)
│   │   │   ├── tools/             # Tool definitions (TS)
│   │   │   ├── storage/           # SQLite + sqlite-vec (TS)
│   │   │   ├── rag/               # Document pipeline (TS)
│   │   │   └── hub/               # Mac Hub connection (TS)
│   │   ├── native/                # Native modules
│   │   │   ├── android/           # Kotlin: llama.cpp bridge, Intents, Service
│   │   │   └── ios/               # Swift: MLX bridge, App Intents (futuro)
│   │   └── assets/
│   │
│   └── mac-hub/                   # Node.js server
│       ├── src/
│       │   ├── server.ts          # WebSocket + mDNS
│       │   ├── ollama-client.ts   # Client Ollama
│       │   └── protocol.ts        # Shared types
│       └── package.json
│
├── packages/
│   └── shared/                    # Codice condiviso
│       ├── protocol.ts            # Tipi WebSocket
│       ├── tool-schema.ts         # Definizioni tool
│       └── types.ts               # Tipi comuni
│
├── scripts/
│   ├── benchmark/                 # Script Fase 0
│   │   ├── run-fc-benchmark.ts    # Benchmark function calling
│   │   ├── prompts_it.jsonl       # Dataset prompt italiani
│   │   └── analyze-results.ts     # Analisi risultati
│   └── data/
│       └── seed-recipes.ts        # Seed knowledge base
│
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── SPEC.md                    # Questo file
│   └── ADR/                       # Architectural Decision Records
│
├── turbo.json                     # Turborepo config
├── package.json                   # Root workspace
└── README.md
```

---

## 2. Schema Database

### 2.1 SQLite Principale (conversations.db)

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
  model_used      TEXT,                     -- es. "qwen3:4b", "functiongemma:270m"
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

-- Valori di default
INSERT INTO config VALUES ('model_primary', 'qwen3:4b');
INSERT INTO config VALUES ('model_classifier', 'functiongemma:270m');
INSERT INTO config VALUES ('model_idle_timeout_ms', '300000');
INSERT INTO config VALUES ('hub_enabled', 'true');
INSERT INTO config VALUES ('hub_auto_connect', 'true');
INSERT INTO config VALUES ('language', 'it');
INSERT INTO config VALUES ('confirm_destructive_actions', 'true');
INSERT INTO config VALUES ('max_context_messages', '10');
```

### 2.2 sqlite-vec (vectors.db)

```sql
-- Tabella virtuale per ricerca vettoriale
-- Creata via sqlite-vec extension

CREATE VIRTUAL TABLE doc_embeddings USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[384]                 -- 384 dimensioni per nomic-embed-text
);

-- Metadata associata ai chunk
CREATE TABLE doc_chunks (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content     TEXT NOT NULL,           -- Testo del chunk
  char_start  INTEGER,                 -- Posizione nel documento originale
  char_end    INTEGER,
  page_number INTEGER,                 -- Per PDF
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_chunks_doc ON doc_chunks(document_id, chunk_index);

-- Query di ricerca semantica:
-- SELECT dc.content, dc.page_number, dc.document_id,
--        vec_distance_cosine(de.embedding, ?) as distance
-- FROM doc_embeddings de
-- JOIN doc_chunks dc ON dc.id = de.id
-- WHERE distance < 0.5
-- ORDER BY distance
-- LIMIT 5;
```

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

```typescript
// lib/orchestrator/prompts.ts

export function buildSystemPrompt(params: {
  tools: ToolDefinition[];
  currentDatetime: string;
  timezone: string;
  language: string;
  memories: string[];
}): string {

  const toolsDescription = params.tools.map(t => {
    const paramsDesc = Object.entries(t.parameters.properties)
      .map(([k, v]) => `    "${k}": ${v.description} (${v.type}${v.format ? ', formato: ' + v.format : ''})`)
      .join('\n');
    const required = t.parameters.required.join(', ');
    return `- ${t.name}: ${t.description}\n  Parametri:\n${paramsDesc}\n  Obbligatori: ${required}`;
  }).join('\n\n');

  const memoriesSection = params.memories.length > 0
    ? `\nInformazioni sull'utente:\n${params.memories.map(m => `- ${m}`).join('\n')}\n`
    : '';

  return `Sei un assistente personale locale. Rispondi in ${params.language}.
Data e ora corrente: ${params.currentDatetime} (${params.timezone})
${memoriesSection}
Quando l'utente chiede di eseguire un'azione, rispondi ESCLUSIVAMENTE con un JSON valido:
{
  "tool": "nome_del_tool",
  "parameters": { ... },
  "message": "Messaggio di conferma per l'utente"
}

Quando l'utente fa una domanda o vuole conversare, rispondi normalmente in testo.

IMPORTANTE:
- Le date devono essere in formato ISO 8601 (es. "2026-03-12T15:00:00")
- Gli orari devono essere in formato HH:MM (es. "07:30" per le 7 e mezza)
- "Domani" significa ${params.currentDatetime.split('T')[0]} + 1 giorno
- "Giovedì prossimo" significa il prossimo giovedì dalla data corrente
- "Stasera" significa oggi tra le 18:00 e le 23:00
- Se un parametro è ambiguo, chiedi chiarimento all'utente

Strumenti disponibili:

${toolsDescription}

Se la richiesta non corrisponde a nessuno strumento, usa "general_chat" e rispondi normalmente.`;
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
                                          │  (llama.cpp)  │
                                          └───────┬───────┘
                                                  │
                                     ┌────────────▼────────────┐
                                     │  sqlite-vec + SQLite    │
                                     │  (doc_embeddings +      │
                                     │   doc_chunks)           │
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
// lib/rag/embedder.ts

// Modello: nomic-embed-text (137M params, GGUF)
// Dimensioni output: 384
// Formato: Float32Array
// Normalizzazione: L2 (cosine similarity via dot product)

export interface EmbedderConfig {
  model: string;           // "nomic-embed-text-v1.5.Q8_0.gguf"
  dimensions: 384;
  batchSize: 32;           // Chunk da embeddare in batch
  prefix: {
    query: "search_query: ";    // Prefisso per query
    document: "search_document: "; // Prefisso per documenti
  };
}
```

### 4.4 Retrieval

```typescript
// lib/rag/retriever.ts

export interface RetrievalOptions {
  query: string;
  maxChunks: number;              // Default: 5
  minSimilarity: number;          // Default: 0.3 (cosine)
  documentFilter?: string;        // Filtra per documento specifico
  diversify: boolean;             // Default: true (MMR per diversità)
}

// Algoritmo:
// 1. Embed query con prefisso "search_query: "
// 2. Ricerca vettoriale in sqlite-vec (top K * 2)
// 3. Se diversify=true, applica Maximal Marginal Relevance (MMR)
//    per evitare chunk troppo simili tra loro
// 4. Ritorna top K chunk con metadata (documento, pagina, posizione)
```

---

## 5. Specifiche Native Module Android

### 5.1 LlamaCppModule (Kotlin + JNI)

```kotlin
// native/android/LlamaCppModule.kt

@ReactModule(name = "LlamaCppModule")
class LlamaCppModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  // Inizializza il modello
  @ReactMethod
  fun initialize(modelPath: String, options: ReadableMap, promise: Promise)
  // options: { nGpuLayers, contextSize, threads, kvCacheType }

  // Genera testo (streaming via eventi)
  @ReactMethod
  fun generate(prompt: String, options: ReadableMap, promise: Promise)
  // options: { maxTokens, temperature, topP, topK, stopSequences, grammarJson }
  // Emette eventi: "onToken", "onComplete", "onError"

  // Calcola embedding
  @ReactMethod
  fun embed(text: String, promise: Promise)
  // Ritorna: { embedding: number[] }

  // Scarica modello dalla RAM
  @ReactMethod
  fun unload(promise: Promise)

  // Info modello caricato
  @ReactMethod
  fun getModelInfo(promise: Promise)
  // Ritorna: { name, parameters, quantization, contextLength, loaded }
}
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
    "vitest": "^3"
  }
}
```

**Native dependencies** (non in package.json, compilate separatamente):
- `llama.cpp` (C++, compilato via Android NDK)
- `sqlite-vec` (C, compilato come estensione SQLite)

### 9.2 Mac Hub

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
- [ ] Node.js 22+ e pnpm installati
- [ ] Expo CLI installato (`npx expo`)
- [ ] Dataset `prompts_it.jsonl` completato (minimo 100 entry)
- [ ] Script benchmark funzionante e testato su almeno un modello
- [ ] Risultati benchmark analizzati e modello primario scelto
