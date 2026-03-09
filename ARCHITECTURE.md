# Vesta — Architecture Document

**Version:** 2.0  
**Data:** 8 Marzo 2026  
**Autore:** Cosmico Engineering  
**Status:** Final Draft  
**Tagline:** *Intelligence that never leaves home.*

---

## 1. Principi Architetturali

Ogni decisione in questo documento deriva da cinque principi, in ordine di priorità:

1. **Offline-first**: ogni feature DEVE funzionare senza internet. Se richiede rete, è un enhancement, non un requisito.
2. **Model-validated**: nessuna infrastruttura viene costruita prima che il modello dimostri di poter eseguire il task. I dati guidano le decisioni, non le intuizioni.
3. **Layer independence**: ogni layer funziona indipendentemente. Se rimuovi il Mac Hub, il telefono funziona. Se rimuovi il RAG, l'assistente risponde. Se rimuovi le System Actions, resta un chatbot locale.
4. **Minimal native**: il codice nativo (Kotlin/Swift/C++) è limitato al minimo necessario (inferenza LLM, Intents di sistema, Foreground Service). Tutto il resto è TypeScript cross-platform.
5. **Single runtime**: un solo motore di inferenza (llama.cpp) per testo, function calling e embedding. Zero dipendenze extra.

---

## 2. Panoramica del Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                      DEVICE (Android / iOS)                      │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    React Native App (TypeScript)             │ │
│  │                                                              │ │
│  │  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐ │ │
│  │  │  Chat UI  │  │  Doc Viewer  │  │  Settings / Status    │ │ │
│  │  └────┬─────┘  └──────┬───────┘  └───────────────────────┘ │ │
│  │       │               │                                      │ │
│  │  ┌────▼───────────────▼──────────────────────────────────┐  │ │
│  │  │              ORCHESTRATOR (TypeScript)                  │  │ │
│  │  │                                                        │  │ │
│  │  │  Message ──► Router ──► Tool Dispatcher ──► Response   │  │ │
│  │  │               │              │                         │  │ │
│  │  │               ▼              ▼                         │  │ │
│  │  │          Conversation    Tool Registry                 │  │ │
│  │  │          Manager         (declarative)                 │  │ │
│  │  └────────────┬───────────────┬───────────────────────────┘  │ │
│  └───────────────┼───────────────┼──────────────────────────────┘ │
│                  │               │                                 │
│  ┌───────────────▼───────────────▼──────────────────────────────┐ │
│  │                   NATIVE BRIDGE (Kotlin / Swift)              │ │
│  │                                                                │ │
│  │  ┌────────────────┐  ┌─────────────────┐  ┌───────────────┐  │ │
│  │  │  LLM Engine    │  │  System Actions  │  │  Foreground   │  │ │
│  │  │  (llama.cpp)   │  │  (Intents)       │  │  Service      │  │ │
│  │  │                │  │                   │  │               │  │ │
│  │  │  - inference   │  │  - alarm          │  │  - keeps LLM  │  │ │
│  │  │  - embedding   │  │  - calendar       │  │    in memory  │  │ │
│  │  │  - tokenize    │  │  - contacts       │  │  - notification│ │ │
│  │  │                │  │  - reminder        │  │  - auto-reload│  │ │
│  │  └────────────────┘  │  - phone/sms      │  └───────────────┘  │ │
│  │                      │  - navigation      │                     │ │
│  │                      │  - file access     │                     │ │
│  │                      └─────────────────┘                       │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    LOCAL STORAGE                               │   │
│  │                                                                │   │
│  │  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐  │   │
│  │  │  SQLite       │  │  sqlite-vec    │  │  Model Files     │  │   │
│  │  │  (messages,   │  │  (embeddings,  │  │  (.gguf)         │  │   │
│  │  │   memories,   │  │   doc chunks)  │  │                  │  │   │
│  │  │   tasks)      │  │                │  │                  │  │   │
│  │  └──────────────┘  └────────────────┘  └──────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│                    ┌──── WiFi LAN (opzionale) ────┐                 │
│                    │                               │                 │
└────────────────────┼───────────────────────────────┼─────────────────┘
                     │                               │
              ┌──────▼───────────────────────────────▼──────┐
              │              MAC HUB (Opzionale)             │
              │                                              │
              │  Ollama (70B/235B) ◄── WebSocket ──► mDNS   │
              │                                              │
              └──────────────────────────────────────────────┘
```

---

## 3. Componenti in Dettaglio

### 3.1 Chat UI (React Native)

Interfaccia chat minimale. Non è il differenziatore del prodotto — l'intelligenza lo è.

**Responsabilità**: input testo/voce, rendering messaggi (markdown), visualizzazione azioni eseguite, picker documenti, indicatore stato modello/connessione.

**NON responsabilità**: nessuna logica di business, nessun accesso diretto al modello, nessuna gestione stato conversazione.

**Librerie chiave**: `react-native` + `expo`, `expo-document-picker`, `expo-speech` (per input vocale via API di sistema).

### 3.2 Orchestrator (TypeScript, cross-platform)

Il cuore logico dell'applicazione. Puro TypeScript senza dipendenze native.

```
Messaggio utente
       │
       ▼
┌──────────────┐     ┌──────────────────────┐
│  Preprocessor │────►│  Context Builder      │
│  (normalize,  │     │  (history, memories,  │
│   detect lang)│     │   device context,     │
│               │     │   available tools)    │
└──────────────┘     └──────────┬───────────┘
                                │
                     ┌──────────▼───────────┐
                     │  LLM Inference       │
                     │  (via Native Bridge) │
                     │                      │
                     │  System Prompt +     │
                     │  Tool Schema +       │
                     │  Context + Message   │
                     └──────────┬───────────┘
                                │
                     ┌──────────▼───────────┐
                     │  Response Parser     │
                     │                      │
                     │  JSON tool call?     │
                     │  ├─ YES → validate   │
                     │  │   → dispatch tool │
                     │  │   → format result │
                     │  └─ NO → text reply  │
                     └──────────┬───────────┘
                                │
                     ┌──────────▼───────────┐
                     │  Response Builder    │
                     │  (format, citations, │
                     │   action confirmations│
                     └──────────────────────┘
```

**Moduli chiave**:

- `orchestrator.ts`: entry point, gestisce il flusso messaggio-risposta
- `router.ts`: costruisce il prompt con tool schema, determina se serve function calling
- `tool-registry.ts`: registro dichiarativo dei tool disponibili
- `tool-dispatcher.ts`: esegue il tool chiamato, gestisce errori e retry
- `conversation-manager.ts`: mantiene history, gestisce multi-turn, compatta contesto
- `memory-manager.ts`: estrae e archivia fatti a lungo termine sull'utente
- `context-builder.ts`: assembla il prompt completo (system + tools + history + context)

### 3.3 Native Bridge

Il layer sottile che collega TypeScript al sistema operativo. Implementato separatamente per Android (Kotlin) e iOS (Swift).

**Principio**: il native bridge è STUPIDO. Non contiene logica di business. Riceve comandi dall'orchestrator TypeScript e li esegue. L'intelligenza sta nell'orchestrator.

#### 3.3.1 LLM Engine (C++ via llama.cpp)

```
┌──────────────────────────────────────────────────┐
│                  LLM Engine API                    │
│                                                    │
│  initialize(modelPath, options) → void             │
│  generate(prompt, options) → AsyncIterator<Token>  │
│  embed(text) → Float32Array                        │
│  tokenize(text) → number[]                         │
│  getModelInfo() → ModelInfo                        │
│  unload() → void                                   │
│                                                    │
│  Options:                                          │
│    temperature, top_p, top_k,                      │
│    max_tokens, stop_sequences,                     │
│    grammar (per JSON constraint)                   │
└──────────────────────────────────────────────────┘
```

**Implementazione Android**: llama.cpp compilato via NDK (arm64-v8a). OpenCL per GPU Adreno su Snapdragon. CPU fallback con KleidiAI per kernel ARM ottimizzati. Il binding Android ufficiale auto-detecta l'hardware.

**Implementazione iOS (futuro)**: MLX-Swift per inferenza nativa con accelerazione Metal/Neural Engine.

#### 3.3.2 System Actions

```
┌──────────────────────────────────────────────────┐
│              System Actions API                    │
│                                                    │
│  setAlarm(time, date?, label?) → Result            │
│  createEvent(title, start, end, location?) → Result│
│  setReminder(text, datetime) → Result              │
│  makeCall(contact_or_number) → Result              │
│  sendSMS(contact_or_number, text) → Result         │
│  navigate(destination) → Result                    │
│  searchContacts(query) → Contact[]                 │
│  getCalendarEvents(date) → Event[]                 │
│  openURL(url) → Result                             │
│  setTimer(duration_seconds, label?) → Result        │
│                                                    │
│  Result: { success, message, error? }              │
└──────────────────────────────────────────────────┘
```

**Implementazione Android**: ogni metodo mappa direttamente su un Android Intent.

- `setAlarm` → `AlarmClock.ACTION_SET_ALARM`
- `createEvent` → `Intent.ACTION_INSERT` con `Events.CONTENT_URI`
- `makeCall` → `Intent.ACTION_DIAL`
- `sendSMS` → `Intent.ACTION_SENDTO`
- `navigate` → `Intent.ACTION_VIEW` con URI `google.navigation`
- `searchContacts` → `ContactsContract` via `ContentResolver`
- `getCalendarEvents` → `CalendarContract` via `ContentResolver`

**Implementazione iOS (futuro)**: App Intents framework per le stesse azioni.

#### 3.3.3 Foreground Service (Android)

Servizio Android con notifica persistente che:
- Tiene il modello LLM caricato in memoria
- Ricarica il modello automaticamente dopo crash
- Scarica il modello dopo N minuti di inattività (configurabile) per risparmiare RAM
- Mostra stato nella notifica: "Modello pronto" / "Caricamento..." / "In attesa"

### 3.4 Local Storage

#### 3.4.1 SQLite (expo-sqlite)

Database principale per dati strutturati. Schema nel documento SPEC.md.

Contiene: conversazioni, messaggi, memorie utente, task schedulati, metadata documenti, configurazione.

#### 3.4.2 sqlite-vec

Estensione C per SQLite che aggiunge ricerca vettoriale HNSW. Compilata come shared library e caricata da SQLite.

Contiene: embedding dei chunk di documenti, embedding delle memorie per ricerca semantica.

#### 3.4.3 Model Files

File `.gguf` nel storage locale dell'app. Scaricati dall'utente al primo avvio o tramite settings. Non inclusi nell'APK.

---

## 4. Flusso Dati: Caso d'Uso Completo

### 4.1 "Fissa appuntamento dal dentista giovedì alle 15"

```
1. [Chat UI] Utente digita messaggio
2. [Orchestrator.preprocessor] Normalizza testo, rileva lingua (it)
3. [Orchestrator.context_builder] Assembla prompt:
   - System prompt con tool schema
   - Ultimi 5 messaggi di history
   - Data/ora corrente del device
   - Tool disponibili (set_alarm, create_event, ...)
4. [Native Bridge.LLM] Genera risposta con grammar constraint JSON
5. [LLM Output]:
   {
     "tool": "create_event",
     "parameters": {
       "title": "Dentista",
       "start": "2026-03-12T15:00:00",
       "end": "2026-03-12T16:00:00"
     },
     "confirmation_message": "Appuntamento dal dentista fissato per giovedì 12 marzo alle 15:00."
   }
6. [Orchestrator.response_parser] Valida JSON, verifica schema tool
7. [Orchestrator.tool_dispatcher] Chiama systemActions.createEvent(...)
8. [Native Bridge.SystemActions] Lancia Intent.ACTION_INSERT
9. [Android OS] Crea evento nel calendario
10. [Native Bridge] Ritorna { success: true }
11. [Orchestrator.response_builder] Costruisce risposta per l'utente
12. [Chat UI] Mostra: "✅ Appuntamento dal dentista fissato per giovedì 12 marzo alle 15:00"
```

### 4.2 "Cosa dice il contratto sulla clausola di recesso?" (RAG)

```
1. [Chat UI] Utente digita domanda (documento già caricato in precedenza)
2. [Orchestrator.router] Rileva intent "query_document"
3. [Orchestrator.context_builder] Genera embedding della domanda
4. [Native Bridge.LLM] embed("clausola di recesso contratto") → vector
5. [sqlite-vec] SELECT chunk_text FROM doc_chunks
   ORDER BY vec_distance(embedding, ?) LIMIT 5
6. [Orchestrator.context_builder] Assembla prompt:
   - System prompt RAG ("Rispondi basandoti SOLO su questi estratti")
   - Top 5 chunk rilevanti
   - Domanda utente
7. [Native Bridge.LLM] Genera risposta
8. [Orchestrator.response_builder] Formatta con citazioni dei chunk
9. [Chat UI] Mostra risposta con riferimenti al documento
```

---

## 5. Gestione Modelli: Strategia a Cascata

### 5.1 Perché la Cascata

Un singolo modello 4B deve fare due cose molto diverse: classificare velocemente ("è una sveglia o una domanda?") e generare risposte di qualità ("spiegami la Rivoluzione Francese"). Questi due task hanno requisiti opposti (velocità vs qualità).

### 5.2 Configurazione di Default

```
Messaggio utente
       │
       ▼
┌──────────────────────┐
│  LAYER 1: Classifier │  FunctionGemma 270M (~0.2GB RAM)
│  "È un comando?"     │  Tempo: ~50ms
│                      │
│  Output:             │
│  - tool_call → JSON  │──────► Esecuzione diretta (fast path)
│  - needs_llm → pass  │
└──────────┬───────────┘
           │ (solo se serve reasoning)
           ▼
┌──────────────────────┐
│  LAYER 2: Reasoner   │  Qwen3 4B (~3GB RAM)
│  "Genera risposta"   │  Tempo: ~2-5 secondi
│                      │
│  Output:             │
│  - text response     │
│  - complex tool_call │
│  - RAG query         │
└──────────────────────┘
```

### 5.3 Decisione: Cascata vs Singolo Modello

La Fase 0 (Model Validation) determina empiricamente se:
- La cascata è più veloce (latenza end-to-end)
- La cascata è più accurata (% comandi correttamente eseguiti)
- Il costo RAM della cascata (0.2 + 3 = 3.2GB) è accettabile vs singolo modello (3GB)

Se i dati mostrano che Qwen3 4B da solo è sufficientemente veloce e accurato nel routing, si elimina il Layer 1 e si semplifica l'architettura. I dati decidono, non le assunzioni.

---

## 6. Comunicazione Mac Hub

### 6.1 Discovery

Il Mac Hub annuncia la propria presenza via mDNS (Bonjour):
- Service type: `_vesta._tcp`
- Port: 8420
- TXT record: `version=1.0`, `models=llama3.1:70b,qwen3:235b`

L'app mobile esegue mDNS scan periodico sulla rete locale e si connette automaticamente quando trova un Hub.

### 6.2 Protocollo WebSocket

```
┌─────────────────────────────────────────────────┐
│            WebSocket Protocol v1                  │
│                                                   │
│  Client (Mobile) → Server (Mac):                  │
│                                                   │
│  CHAT     { type, content, conversationId,        │
│             context: { history, tools, device } }  │
│  EMBED    { type, text }                           │
│  UPLOAD   { type, filename, chunks: base64[] }     │
│  PING     { type }                                 │
│                                                   │
│  Server (Mac) → Client (Mobile):                   │
│                                                   │
│  STREAM_START  { type, conversationId }            │
│  STREAM_CHUNK  { type, token }                     │
│  STREAM_END    { type, conversationId }            │
│  EMBED_RESULT  { type, vector: number[] }          │
│  UPLOAD_ACK    { type, documentId }                │
│  PONG          { type, models: string[] }          │
│  ERROR         { type, code, message }             │
│                                                   │
└─────────────────────────────────────────────────┘
```

### 6.3 Fallback Trasparente

L'orchestrator ha un connection manager che:
1. Se Hub connesso → delega task complessi al Mac (modello grande, RAG documenti pesanti)
2. Se Hub non connesso → processa tutto localmente (modello piccolo, qualità inferiore ma funzionale)
3. Il switch è trasparente all'utente. La UI mostra un indicatore discreto ("🟢 Hub connesso" / "📱 Locale")

---

## 7. Decisioni Architetturali (ADR)

### ADR-001: llama.cpp come unico runtime di inferenza

**Contesto**: servono inferenza testo, function calling, e embedding su mobile.

**Decisione**: usare llama.cpp per tutti e tre i task.

**Alternative considerate**: MLC LLM (richiede ricompilazione per modello), ONNX Runtime (aggiunge secondo runtime), ExecuTorch (Meta-specifico, meno maturo).

**Motivazione**: llama.cpp ha il binding Android ufficiale con auto-detection hardware, supporta qualsiasi modello GGUF senza ricompilazione, ha il supporto embedding nativo, e la community più grande (200K+ stars). Un solo runtime = meno bug, meno dimensione APK, meno manutenzione.

### ADR-002: React Native invece di Kotlin nativo

**Contesto**: lo sviluppatore principale ha background TypeScript, non Kotlin.

**Decisione**: React Native + Expo per la maggior parte dell'app. Kotlin solo per native module (llama.cpp bridge, Intents, Foreground Service).

**Motivazione**: riduce il tempo di sviluppo del 60-70%. Il 90% della logica (orchestrator, router, conversation manager, UI) è TypeScript cross-platform. Quando si aggiunge iOS, si riscrive solo il native module (~500 righe).

### ADR-003: sqlite-vec invece di ChromaDB/ObjectBox

**Contesto**: serve un vector store per RAG su mobile.

**Decisione**: sqlite-vec (estensione C per SQLite).

**Alternative considerate**: ChromaDB (troppo pesante per mobile, richiede Python), ObjectBox (dipendenza Java/Kotlin pesante, vendor lock-in).

**Motivazione**: sqlite-vec pesa ~100KB, si integra nel SQLite già presente in Android, supporta HNSW per ricerca approssimata. Zero dipendenze extra. Funziona identicamente su Android e iOS.

### ADR-004: Foreground Service con model lifecycle management

**Contesto**: Android uccide i processi in background dopo pochi minuti. Ricaricare un modello 4B richiede 5-10 secondi.

**Decisione**: Foreground Service con notifica persistente. Il modello viene scaricato dalla RAM dopo 5 minuti di inattività e ricaricato on-demand.

**Motivazione**: il Foreground Service è l'unico modo garantito per mantenere un processo attivo su Android. Lo scaricamento dopo inattività bilancia battery drain e reattività.

### ADR-005: Model validation prima di architettura (Fase 0)

**Contesto**: l'intera app dipende dalla capacità di un modello 3-4B di capire comandi in italiano e generare JSON strutturato.

**Decisione**: dedicare la prima settimana interamente al testing dei modelli. Nessun codice Android scritto prima di avere dati concreti su accuratezza e performance.

**Motivazione**: se il modello non funziona, nessuna architettura ti salva. Meglio scoprirlo in 7 giorni che in 3 mesi.

---

## 8. Sicurezza

### 8.1 Threat Model

- **Nessun attacco di rete**: l'app non comunica con server esterni. Il Mac Hub è sulla rete locale.
- **Accesso fisico al device**: le conversazioni e i documenti sono sul device. Se il device è compromesso, i dati sono esposti. Mitigazione: encryption at rest con la chiave di Android Keystore.
- **Prompt injection via documenti**: un PDF malizioso potrebbe contenere testo che manipola il modello. Mitigazione: i chunk di documento vengono iniettati in un contesto separato con istruzioni chiare al modello di non eseguire azioni basate sul contenuto del documento.
- **Azioni non autorizzate**: il modello potrebbe hallucinate un'azione non richiesta. Mitigazione: conferma esplicita per azioni distruttive (cancellare, inviare messaggi, chiamare).

### 8.2 Permessi Android

Permessi richiesti e motivazione:

| Permesso | Motivo | Obbligatorio |
|---|---|---|
| `SET_ALARM` | Impostare sveglie | Sì |
| `READ_CALENDAR` / `WRITE_CALENDAR` | Leggere e creare eventi | Sì |
| `READ_CONTACTS` | Cercare contatti per nome | Sì |
| `CALL_PHONE` | Avviare chiamate | No (chiede Intent) |
| `SEND_SMS` | Compilare SMS | No (chiede Intent) |
| `READ_EXTERNAL_STORAGE` | Leggere PDF/documenti | Sì (per RAG) |
| `FOREGROUND_SERVICE` | Tenere il modello in memoria | Sì |
| `POST_NOTIFICATIONS` | Notifica Foreground Service | Sì |
| `ACCESS_NETWORK_STATE` | Rilevare WiFi per Mac Hub | No (per Hub) |
