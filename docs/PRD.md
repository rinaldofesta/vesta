# Vesta — Product Requirements Document (PRD)

**Version:** 2.0  
**Data:** 8 Marzo 2026  
**Autore:** Cosmico Engineering  
**Status:** Final Draft  
**Tagline:** *Intelligence that never leaves home.*

---

## 1. Executive Summary

Vesta è un assistente personale AI che gira interamente in locale su smartphone, tablet e computer. L'utente interagisce via chat in linguaggio naturale per eseguire azioni di sistema (sveglie, calendario, promemoria), interrogare documenti personali, apprendere interattivamente e automatizzare task quotidiani — tutto senza connessione internet.

A differenza di Siri, Google Assistant o Alexa, Vesta non invia mai dati a server esterni. A differenza di OpenClaw e NanoClaw, non dipende da modelli cloud per l'intelligenza. È il primo orchestratore di agenti AI progettato per essere offline-first, multi-device e con accesso nativo alle API del dispositivo.

---

## 2. Problema

L'utente moderno vive in un ecosistema frammentato: usa Siri per le sveglie, Google per le ricerche, ChatGPT per le domande complesse, app separate per calendario, note, documenti. Ogni interazione richiede: connessione internet, fiducia verso un cloud provider, switch di contesto tra app diverse.

I problemi specifici che Vesta risolve:

- **Privacy**: ogni prompt inviato a un LLM cloud viene processato su server di terze parti. Per dati sensibili (medici, legali, finanziari, personali), questo è un rischio concreto.
- **Dipendenza dalla rete**: in aereo, in montagna, in metropolitana, in zone con scarsa copertura — gli assistenti cloud non funzionano.
- **Frammentazione**: per impostare una sveglia basata su un evento del calendario e il contenuto di un documento, l'utente deve usare 3 app diverse.
- **Costo**: le subscription AI (ChatGPT Plus, Claude Pro) costano $20-200/mese. Un modello locale gira gratis dopo il download iniziale.
- **Controllo**: l'utente non può scegliere quale modello AI usa, come vengono trattati i suoi dati, o quali capability ha l'assistente.

---

## 3. Vision

> "Un assistente AI che vive nel tuo dispositivo, conosce i tuoi documenti, esegue le tue azioni, e non ha bisogno di chiedere permesso a nessun server."

**Entro 6 mesi**: un'app Android funzionante che risponde a comandi vocali/testo, esegue azioni di sistema, e risponde a domande su documenti personali — tutto offline.

**Entro 12 mesi**: supporto iOS, multi-device sync, agent swarm, knowledge base offline (enciclopedia, ricette), e Accessibility Service per automazione app di terze parti.

**Entro 24 mesi**: il protocollo aperto "Vesta Protocol" diventa lo standard per agenti AI locali. Community di sviluppatori che crea plugin/skill. Marketplace di modelli ottimizzati per task specifici.

---

## 4. Language Strategy

Vesta is a global product with Italian DNA. Three tiers:

**Tier 1 — Launch (Day 1):** English + Italian. English is mandatory (90% of early adopters are English-speaking developers). Italian is the competitive edge and stress-test language — more ambiguous and colloquial than English. If function calling works in Italian, it works everywhere.

**Tier 2 — Month 3-6:** Spanish, French, German, Portuguese. Spanish is priority because Cosmico already operates in Spain. These 6 languages cover 70-80% of the European and American market.

**Tier 3 — Month 6+:** Community-driven. Languages follow demand.

Implementation: Qwen3 4B already supports 100+ languages natively. No model change needed. What needs per-language work: the benchmark dataset (Fase 0), the system prompt temporal reasoning ("domani", "tomorrow", "mañana"), and the confirmation messages. The Fase 0 benchmark MUST include prompts in both English and Italian from day 1.

---

## 5. Target Users

### 4.1 Utente Primario: Developer / Power User (Early Adopter)
- Usa già LLM locali (Ollama, LM Studio)
- Vuole controllare i propri dati
- Disposto a configurare e sperimentare
- Device: smartphone flagship Android (8GB+ RAM), Mac per sviluppo

### 4.2 Utente Secondario: Professionista Privacy-Conscious
- Avvocati, medici, consulenti finanziari
- Gestisce dati sensibili dei clienti
- Non può inviare dati a server cloud per compliance (GDPR, HIPAA)
- Vuole interrogare documenti localmente

### 4.3 Utente Terziario: Studente / Ricercatore
- Carica PDF/appunti e vuole un tutor interattivo
- Studia offline (treno, aereo, zone remote)
- Budget limitato (no subscription cloud)

---

## 5. User Stories

### 5.1 Azioni di Sistema (Priority: P0)

| ID | User Story | Criterio di Accettazione |
|---|---|---|
| US-01 | "Svegliami domani alle 7 e mezza" | Sveglia creata nel sistema operativo. Conferma mostrata in chat. |
| US-02 | "Fissa appuntamento dal dentista giovedì prossimo alle 15" | Evento creato nel calendario predefinito con titolo "Dentista", data corretta, ora 15:00. |
| US-03 | "Ricordami di comprare il latte stasera alle 19" | Promemoria creato con notifica alle 19:00. |
| US-04 | "Chiama Marco" | Intent di chiamata lanciato verso il contatto "Marco" dalla rubrica. |
| US-05 | "Manda un messaggio a Laura: arrivo tra 10 minuti" | Intent SMS pre-compilato con destinatario e testo. |
| US-06 | "Che appuntamenti ho domani?" | Lettura calendario del giorno successivo, elenco eventi mostrato in chat. |
| US-07 | "Portami al Colosseo" | Intent navigazione con destinazione "Colosseo, Roma". |

### 5.2 Conversazione Libera (Priority: P0)

| ID | User Story | Criterio di Accettazione |
|---|---|---|
| US-10 | "Qual è la ricetta della carbonara?" | Risposta testuale completa con ingredienti e procedimento. |
| US-11 | "Chi era Napoleone?" | Risposta testuale accurata, generata dal modello locale. |
| US-12 | "Traducimi 'buongiorno' in giapponese" | Traduzione corretta mostrata in chat. |
| US-13 | Conversazione multi-turn su un argomento | Contesto mantenuto tra i messaggi. Risposte coerenti. |

### 5.3 Document Intelligence (Priority: P1)

| ID | User Story | Criterio di Accettazione |
|---|---|---|
| US-20 | "Carica questo PDF e dimmi di cosa parla" | PDF parsato, indicizzato, summary generata. |
| US-21 | "Cosa dice il contratto sulla clausola di recesso?" | Ricerca semantica nei chunk, risposta con riferimento al paragrafo. |
| US-22 | "Confronta questi due documenti" | Analisi comparativa basata su RAG multi-documento. |
| US-23 | "Sto studiando la Rivoluzione Francese [da PDF]. Chi era Robespierre?" | RAG retrieval + risposta contestualizzata dal documento caricato. |

### 5.4 Studio Interattivo (Priority: P2)

| ID | User Story | Criterio di Accettazione |
|---|---|---|
| US-30 | "Creami un piano di studio sulla Rivoluzione Francese" | Piano strutturato con lezioni progressive e domande di verifica. |
| US-31 | "Fammi un quiz su quello che abbiamo studiato" | Quiz con domande, opzioni, feedback correttivo. |
| US-32 | "Non ho capito il concetto di Terrore, spiegamelo meglio" | Spiegazione adattiva basata sul contesto della sessione di studio. |

### 5.5 Mac Hub (Priority: P2)

| ID | User Story | Criterio di Accettazione |
|---|---|---|
| US-40 | Connessione automatica al Mac sulla stessa rete | Discovery via mDNS, connessione WebSocket, indicatore nell'app. |
| US-41 | "Analizza questo documento complesso" (delegato al Mac) | Il telefono invia al Mac, il Mac risponde con modello 70B, la risposta appare nell'app. |
| US-42 | Tutto funziona anche senza il Mac | Nessun task fallisce se il Mac non è raggiungibile. Qualità inferiore ma funzionale. |

---

## 6. Requisiti Non-Funzionali

### 6.1 Performance
- **Tempo al primo token**: <2 secondi su flagship Android (Snapdragon 8 Gen 3+)
- **Velocità generazione**: ≥10 tok/s per risposte conversazionali
- **Routing intent**: <500ms dalla ricezione del messaggio alla classificazione del tool
- **Esecuzione azione sistema**: <1 secondo dall'identificazione del tool all'esecuzione dell'Intent
- **Caricamento modello**: <10 secondi dal cold start alla prima inferenza

### 6.2 Privacy e Sicurezza
- **Zero dati in uscita**: nessuna richiesta di rete per inferenza, embedding o tool execution
- **Storage locale criptato**: conversazioni e documenti in database SQLite con encryption at rest
- **No telemetria**: nessun analytics, crash reporting o tracking di alcun tipo
- **Audit trail**: l'utente può esportare e ispezionare tutti i dati archiviati

### 6.3 Affidabilità
- **Offline 100%**: tutte le feature P0 e P1 funzionano senza connessione internet
- **Graceful degradation**: se il modello non riesce a parsare un comando, risponde comunque in modalità conversazionale
- **Recovery**: se il modello crasha, il Foreground Service lo ricarica automaticamente
- **Battery**: <5% consumo batteria/ora in idle, <15% durante inferenza attiva

### 6.4 Compatibilità
- **Android**: 10+ (API 29), target 14+ (API 34). Ottimizzato per Snapdragon 8 Gen 2+
- **RAM minima**: 6GB (modello 2B), 8GB consigliato (modello 4B)
- **Storage**: ~4GB per app + modello base
- **iOS (futuro)**: iPhone 15 Pro+ (A17 Pro, 8GB RAM)

---

## 7. Metriche di Successo

### 7.1 Metriche Tecniche (Fase 0)
- Function calling accuracy in italiano: ≥95% su comandi chiari, ≥80% su comandi ambigui
- JSON parsing success rate: ≥98% (JSON valido generato dal modello)
- Intent mapping accuracy: ≥97% (il JSON mappa correttamente all'Intent Android)

### 7.2 Metriche Prodotto (Fase 1-3)
- Tempo medio task completion (dall'input utente all'azione eseguita): <5 secondi
- Crash rate: <1% delle sessioni
- Retention D7: ≥40% degli utenti che installano l'app la usano dopo 7 giorni
- NPS (Net Promoter Score): ≥50 tra gli early adopter

### 7.3 Metriche di Crescita (Fase 4+)
- GitHub stars: 1K+ entro 3 mesi dal rilascio open source
- Community skill contributions: 10+ skill di terze parti entro 6 mesi
- Downloads: 10K+ su APK diretto / F-Droid entro 6 mesi

---

## 8. Cosa NON è Vesta (Anti-Scope)

- **Non è un sostituto di ChatGPT/Claude**: per task che richiedono modelli frontier (coding complesso, analisi legale profonda, generazione creativa avanzata), l'utente userà ancora modelli cloud. Vesta eccelle nei task quotidiani e nella privacy.
- **Non è un bot di automazione UI** (nella V1): l'Accessibility Service per controllare app di terze parti è una feature Phase 5+, non parte del core.
- **Non è un server LLM**: non espone API per altri client. È un'app utente.
- **Non è un prodotto Apple-only**: nasce su Android, poi si espande a iOS. Cross-platform by design.
- **Non è un clone di OpenClaw**: OpenClaw è centrato su messaging (WhatsApp/Telegram) e modelli cloud. Vesta è centrato su inferenza locale e azioni di sistema native.

---

## 9. Rischi e Mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|
| Modelli 3-4B insufficienti per function calling in italiano | Media | Critico | Fase 0 dedicata interamente al testing. Fallback: fine-tuning su dataset italiano. |
| Performance inaccettabili su device mid-range | Media | Alto | Strategia a cascata (FunctionGemma 270M per routing, modello 4B solo quando serve). |
| Battery drain eccessivo | Media | Alto | Model offloading dopo inattività. Ottimizzazione KV cache (q4_0). Benchmark continui. |
| Frammentazione Android (GPU Mali vs Adreno) | Alta | Medio | CPU-only come fallback universale. GPU acceleration solo su device verificati. |
| Apple blocca la distribuzione iOS | Bassa | Alto | Primo rilascio solo Android. iOS via TestFlight e sideloading. Compliance App Store Review Guidelines. |
| Modello genera azioni non richieste (hallucination) | Media | Critico | Conferma esplicita per azioni distruttive (cancellare eventi, inviare messaggi). Tool schema stretto. |

---

## 10. Roadmap with Exit Gates

Each phase has a clear exit gate: what must be TRUE before moving to the next phase. Do NOT advance without hitting the gate.

```
FASE 0  [Week 1]        Model Validation
  ├─ Test models on Mac with Ollama
  ├─ 50 prompts IT + 50 prompts EN covering 4 core tools
  ├─ Benchmark: accuracy, latency, JSON validity per model
  └─ EXIT GATE: ≥90% function calling accuracy on clear commands
                in both IT and EN for the chosen model + system prompt

FASE 1  [Week 2-4]      Android MVP
  ├─ React Native + Expo project
  ├─ llama.cpp native module (official Android binding)
  ├─ Foreground Service (model stays in memory)
  ├─ 4 tools ONLY: set_alarm, create_event, set_reminder, general_chat
  ├─ Chat UI (minimal, functional)
  └─ EXIT GATE: Say "Hey Vesta, svegliami domani alle 7" on a real
                Android phone → alarm is set. End to end, offline.

FASE 2  [Week 5-7]      Core Polish
  ├─ Add remaining system tools: make_call, send_sms, set_timer, navigate
  ├─ Add read tools: get_calendar_events, search_contacts
  ├─ Conversation history + multi-turn context
  ├─ Settings screen (model selection, language preference)
  └─ EXIT GATE: All 10 tools work reliably. Multi-turn conversation
                maintains context across 5+ messages.

FASE 3  [Week 8-10]     Document Intelligence (RAG)
  ├─ PDF/DOCX/TXT parser
  ├─ Chunking + embedding via llama.cpp (nomic-embed-text)
  ├─ sqlite-vec for vector search
  ├─ query_document tool
  └─ EXIT GATE: Upload a 20-page PDF, ask a specific question,
                get a correct answer with source reference. Offline.

FASE 4  [Week 11-13]    Mac Hub (Vesta Hearth)
  ├─ Node.js WebSocket server + Ollama on Mac
  ├─ mDNS discovery (automatic on LAN)
  ├─ Delegate complex queries to 70B model
  ├─ Transparent fallback (phone works without Mac)
  └─ EXIT GATE: Phone auto-connects to Mac when on same WiFi.
                Complex query answered by 70B. Disconnect Mac → phone
                answers same query with local model (lower quality, still works).

FASE 5  [Week 14-17]    iOS Port
  ├─ MLX-Swift native module for inference
  ├─ App Intents framework for system actions
  ├─ Same React Native UI, different native bridge
  └─ EXIT GATE: Same demo ("svegliami alle 7") works on iPhone.

FASE 6  [Week 18+]      MCP + Advanced
  ├─ MCP Server: expose Vesta tools as MCP endpoints (local agent infra)
  ├─ Study plans + interactive tutor
  ├─ Multi-agent swarm
  ├─ Accessibility Service (Android, opt-in, sideload only)
  ├─ Offline knowledge base (Wikipedia, recipes)
  └─ EXIT GATE: Per-feature, defined when each starts.
```
