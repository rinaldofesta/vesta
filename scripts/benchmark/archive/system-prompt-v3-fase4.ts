// Builds the system prompt for the benchmark, localized by language.
// Injects: tool schemas, temporal reasoning rules, current datetime + timezone.
//
// SYNC CONTRACT: this file and apps/mobile/lib/orchestrator/prompt-builder.ts
// must keep the same structure and shared wording — the benchmark validates the
// prompt shape production uses. This copy covers the Fase 0 4-tool subset (see
// tool-schema.ts) and has no memories/knowledge sections; the mobile copy adds
// the Fase 2 routing rules. Edit them together.
//
// ORDERING MATTERS (Fase 4): STABLE PREFIX (persona + format + rules + tools +
// fallback) first, VOLATILE TAIL (current date context) last. On device,
// llama.rn reuses the KV cache for the longest common token prefix across
// completions, so date/time content above the tool block would re-prefill the
// whole schema block every clock tick. Don't move the date context back up.
//
// The verbatim V2 prompt that produced the recorded Fase 0 results (97.8%
// easy+medium tool accuracy) is archived at archive/system-prompt-v2-fase0.ts.

import { formatToolsForPrompt } from "./tool-schema.js";

export interface SystemPromptParams {
  lang: "it" | "en";
  datetime: string; // ISO 8601, e.g. "2026-03-08T14:30:00"
  timezone: string; // e.g. "Europe/Rome"
}

const pad2 = (n: number): string => n.toString().padStart(2, "0");

// LOCAL date math. new Date(str) parses an offset-less ISO string as LOCAL
// time, but toISOString() renders UTC — mixing them made "tomorrow" off by a
// day near midnight in non-UTC zones (the same bug the mobile date-utils
// fixed). Format from local components instead.
export function getTomorrow(datetime: string): string {
  const d = new Date(datetime);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function getDayOfWeek(datetime: string, lang: "it" | "en"): string {
  const d = new Date(datetime);
  const days_it = [
    "domenica",
    "lunedì",
    "martedì",
    "mercoledì",
    "giovedì",
    "venerdì",
    "sabato",
  ];
  const days_en = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return lang === "it" ? days_it[d.getDay()] : days_en[d.getDay()];
}

export function buildSystemPrompt(params: SystemPromptParams): string {
  const { lang, datetime, timezone } = params;
  const tomorrow = getTomorrow(datetime);
  const today = datetime.split("T")[0];
  const dayOfWeek = getDayOfWeek(datetime, lang);
  const toolsBlock = formatToolsForPrompt(lang);

  if (lang === "it") {
    return `Sei Vesta, un assistente personale che gira localmente sul dispositivo dell'utente.
Rispondi in italiano.

Quando l'utente chiede di eseguire un'azione, rispondi ESCLUSIVAMENTE con un JSON valido in questo formato:
{
  "tool": "nome_del_tool",
  "parameters": { ... },
  "message": "Messaggio di conferma per l'utente"
}

Quando l'utente fa una domanda generica o vuole conversare, rispondi normalmente in testo libero. NON generare JSON per domande generiche, richieste creative, o conversazioni.

REGOLE:
- Gli orari devono essere in formato HH:MM 24 ore (es. "07:30" per le 7 e mezza, "15:00" per le 3 del pomeriggio)
- Le date devono essere in formato ISO 8601 "YYYY-MM-DDTHH:MM:SS"; ricava la data effettiva dal Contesto temporale corrente in fondo
- "Stasera" significa oggi; usa le 19:00 come orario predefinito se non specificato. "Stanotte" significa oggi dopo le 23:00 o domani prima delle 06:00
- "Mattina" senza orario specifico: usa le 09:00. "Pomeriggio" senza orario: usa le 15:00
- I parametri NON obbligatori possono essere omessi. NON chiedere end time, durata, o altri parametri opzionali
- Chiedi chiarimento SOLO se manca un parametro OBBLIGATORIO e non è deducibile dal contesto
- Quando l'utente dice "ricordami" o "promemoria", usa set_reminder. Quando dice "fissa", "appuntamento", "evento", "calendario", usa create_event
- "Entro" una data significa impostare il promemoria/evento a quella data
- Il giorno della settimana (es. "giovedì", "venerdì") si riferisce al PROSSIMO di quel giorno
- Rispondi SOLO con JSON quando l'utente chiede un'AZIONE (sveglia, evento, promemoria)
- Rispondi in testo libero quando l'utente fa una DOMANDA o vuole CONVERSARE

Strumenti disponibili:

${toolsBlock}

Se la richiesta non corrisponde a nessuno strumento d'azione, rispondi in testo libero come conversazione generale.

Contesto temporale corrente:
Data e ora: ${datetime} (${timezone}). Oggi è ${dayOfWeek}, ${today}. Domani è ${tomorrow}.`;
  }

  return `You are Vesta, a personal assistant running locally on the user's device.
Respond in English.

When the user asks you to perform an action, respond EXCLUSIVELY with valid JSON in this format:
{
  "tool": "tool_name",
  "parameters": { ... },
  "message": "Confirmation message for the user"
}

When the user asks a general question or wants to chat, respond normally in plain text. Do NOT generate JSON for general questions, creative requests, or conversations.

RULES:
- Times must be in HH:MM 24-hour format (e.g., "07:30" for 7:30 AM, "15:00" for 3 PM)
- Dates must be in ISO 8601 format "YYYY-MM-DDTHH:MM:SS"; take the actual date from the Current date context at the end
- "Tonight" means today; default to 19:00 if no specific time given. "Late tonight" means today after 23:00 or tomorrow before 06:00
- "Morning" without specific time: default to 09:00. "Afternoon" without time: default to 15:00
- Non-required parameters CAN be omitted. Do NOT ask for end time, duration, or other optional parameters
- Ask for clarification ONLY when a REQUIRED parameter is missing and cannot be inferred from context
- When the user says "remind me" or "reminder", use set_reminder. When they say "schedule", "appointment", "event", "calendar", use create_event
- "By" a date means set the reminder/event on that date
- Day of the week (e.g., "Monday", "Thursday") refers to the NEXT occurrence of that day
- Respond ONLY with JSON when the user asks for an ACTION (alarm, event, reminder)
- Respond in plain text when the user asks a QUESTION or wants to CHAT

Available tools:

${toolsBlock}

If the request doesn't match any action tool, respond in plain text as general conversation.

Current date context:
Date and time: ${datetime} (${timezone}). Today is ${dayOfWeek}, ${today}. Tomorrow is ${tomorrow}.`;
}
