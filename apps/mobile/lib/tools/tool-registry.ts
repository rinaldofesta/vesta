// Tool definitions for Vesta MVP (Fase 1: 4 tools only)
// Ported from scripts/benchmark/tool-schema.ts — the same schemas that
// achieved 97.8% accuracy in Fase 0.

export interface ParameterDef {
  type: "string" | "number" | "boolean";
  description: string;
  format?: string;
}

export interface ToolDefinition {
  name: string;
  description_it: string;
  description_en: string;
  category: "system_action" | "knowledge" | "utility";
  confirmRequired: boolean;
  // Read/query tools: the dispatcher returns data that must be fed back to the
  // model for a natural-language answer (a second generation), rather than the
  // model's pre-written confirmation being the final reply.
  returnsData?: boolean;
  parameters: {
    type: "object";
    properties: Record<string, ParameterDef>;
    required: string[];
  };
}

export const MVP_TOOLS: ToolDefinition[] = [
  {
    name: "set_alarm",
    description_it: "Imposta una sveglia ad un orario specifico",
    description_en: "Set an alarm at a specific time",
    category: "system_action",
    confirmRequired: true,
    parameters: {
      type: "object",
      properties: {
        time: {
          type: "string",
          description: "Alarm time in HH:MM format (24h)",
          format: "HH:MM",
        },
        date: {
          type: "string",
          description: "Date if different from today (YYYY-MM-DD)",
          format: "YYYY-MM-DD",
        },
        label: {
          type: "string",
          description: "Optional label for the alarm",
        },
      },
      required: ["time"],
    },
  },
  {
    name: "create_event",
    description_it: "Crea un evento o appuntamento nel calendario",
    description_en: "Create a calendar event or appointment",
    category: "system_action",
    confirmRequired: true,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title" },
        start: {
          type: "string",
          description: "Start date and time in ISO 8601 format",
          format: "ISO8601",
        },
        end: {
          type: "string",
          description: "End date and time in ISO 8601 format",
          format: "ISO8601",
        },
        location: { type: "string", description: "Event location" },
      },
      required: ["title", "start"],
    },
  },
  {
    name: "set_reminder",
    description_it: "Crea un promemoria con notifica ad un certo orario",
    description_en: "Create a reminder with notification at a specific time",
    category: "system_action",
    confirmRequired: true,
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Reminder text" },
        datetime: {
          type: "string",
          description: "When to remind, in ISO 8601 format",
          format: "ISO8601",
        },
      },
      required: ["text", "datetime"],
    },
  },
  {
    name: "set_timer",
    description_it:
      "Imposta un timer (conto alla rovescia) di una durata in minuti",
    description_en: "Set a countdown timer for a number of minutes",
    category: "system_action",
    confirmRequired: false,
    parameters: {
      type: "object",
      properties: {
        minutes: {
          type: "number",
          description: "Timer duration in minutes (must be > 0)",
        },
        label: {
          type: "string",
          description: "Optional label for the timer",
        },
      },
      required: ["minutes"],
    },
  },
  {
    name: "navigate_to",
    description_it:
      "Avvia la navigazione verso una destinazione usando l'app mappe",
    description_en: "Start navigation to a destination using the maps app",
    category: "system_action",
    confirmRequired: false,
    parameters: {
      type: "object",
      properties: {
        destination: {
          type: "string",
          description: "Destination address or place name",
        },
      },
      required: ["destination"],
    },
  },
  {
    name: "search_contacts",
    description_it:
      "Cerca un contatto nella rubrica per nome e ottieni i suoi numeri",
    description_en: "Search the address book for a contact by name",
    category: "system_action",
    confirmRequired: false,
    returnsData: true,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Name (or part of a name) to search for",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "make_call",
    description_it: "Avvia una telefonata a un contatto o numero",
    description_en: "Start a phone call to a contact or number",
    category: "system_action",
    confirmRequired: true,
    parameters: {
      type: "object",
      properties: {
        contact: {
          type: "string",
          description: "Contact name or phone number to call",
        },
      },
      required: ["contact"],
    },
  },
  {
    name: "send_sms",
    description_it: "Componi un SMS per un contatto o numero",
    description_en: "Compose an SMS to a contact or number",
    category: "system_action",
    confirmRequired: true,
    parameters: {
      type: "object",
      properties: {
        contact: {
          type: "string",
          description: "Contact name or phone number to message",
        },
        text: { type: "string", description: "Message body" },
      },
      required: ["contact", "text"],
    },
  },
  {
    name: "get_calendar_events",
    description_it:
      "Leggi gli appuntamenti del calendario per una data specifica",
    description_en: "Read calendar events/appointments for a specific date",
    category: "system_action",
    confirmRequired: false,
    returnsData: true,
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Day to read events for (YYYY-MM-DD)",
          format: "YYYY-MM-DD",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "query_document",
    description_it:
      "Cerca informazioni nei documenti importati dall'utente e rispondi in base al loro contenuto",
    description_en:
      "Search the user's imported documents and answer from their content",
    category: "knowledge",
    confirmRequired: false,
    returnsData: true,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to look up in the user's documents",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "general_chat",
    description_it:
      "Rispondi a una domanda generica, una conversazione, o una richiesta creativa",
    description_en:
      "Respond to a general question, conversation, or creative request",
    category: "utility",
    confirmRequired: false,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// Whether a parsed tool call must be confirmed by the user before it runs.
// `confirmEnabled` is the global `confirm_destructive_actions` setting; a tool
// is gated only when both the global setting is on AND the tool is marked
// destructive (confirmRequired). Unknown tools are treated as not-gated (they
// fail validation downstream).
export function toolRequiresConfirmation(
  toolName: string,
  confirmEnabled: boolean,
): boolean {
  if (!confirmEnabled) return false;
  const def = MVP_TOOLS.find((t) => t.name === toolName);
  return def?.confirmRequired ?? false;
}

// Read/query tools whose result must be fed back to the model for an answer.
export function toolReturnsData(toolName: string): boolean {
  return MVP_TOOLS.find((t) => t.name === toolName)?.returnsData ?? false;
}

export function formatToolsForPrompt(lang: "it" | "en"): string {
  return MVP_TOOLS.map((t) => {
    const desc = lang === "it" ? t.description_it : t.description_en;
    const props = Object.entries(t.parameters.properties);
    const paramsBlock =
      props.length > 0
        ? props
            .map(
              ([k, v]) =>
                `    "${k}": ${v.description} (${v.type}${v.format ? ", format: " + v.format : ""})`
            )
            .join("\n")
        : "    (none)";
    const required =
      t.parameters.required.length > 0
        ? t.parameters.required.join(", ")
        : "none";
    return `- ${t.name}: ${desc}\n  Parameters:\n${paramsBlock}\n  Required: ${required}`;
  }).join("\n\n");
}
