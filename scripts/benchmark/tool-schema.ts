// Tool definitions for Fase 0 benchmark (MVP: 4 tools only)
// These mirror the schema from SPEC.md but are limited to the 4 tools
// that Fase 0 validates: set_alarm, create_event, set_reminder, general_chat

export interface ParameterDef {
  type: "string" | "number" | "boolean";
  description: string;
  format?: string;
}

export interface ToolDefinition {
  name: string;
  description_it: string;
  description_en: string;
  parameters: {
    type: "object";
    properties: Record<string, ParameterDef>;
    required: string[];
  };
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "set_alarm",
    description_it: "Imposta una sveglia ad un orario specifico",
    description_en: "Set an alarm at a specific time",
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
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Event title",
        },
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
        location: {
          type: "string",
          description: "Event location",
        },
      },
      required: ["title", "start"],
    },
  },
  {
    name: "set_reminder",
    description_it: "Crea un promemoria con notifica ad un certo orario",
    description_en: "Create a reminder with notification at a specific time",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Reminder text",
        },
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
    name: "general_chat",
    description_it:
      "Rispondi a una domanda generica, una conversazione, o una richiesta creativa",
    description_en:
      "Respond to a general question, conversation, or creative request",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export function formatToolsForPrompt(lang: "it" | "en"): string {
  return TOOLS.map((t) => {
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
