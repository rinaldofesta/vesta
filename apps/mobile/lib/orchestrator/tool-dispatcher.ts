// Tool Dispatcher — routes parsed tool calls to native module actions.
// In Fase 1, tools map to Android Intents via SystemActionsModule.

import type { ToolCallResult, Language } from "./types";
import { MVP_TOOLS } from "../tools/tool-registry";
import { setAlarm, createEvent, setTimer, navigateTo } from "../native/system-actions";
import { scheduleReminder } from "../native/reminders";
import { searchContacts } from "../native/contacts";
import { makeCall, sendSms } from "../native/communication";
import { getCalendarEvents } from "../native/calendar";
import { queryDocuments } from "./document-retriever";
import { isValidYMD } from "./date-utils";

const FORMAT_VALIDATORS: Record<string, (value: string) => string | null> = {
  "HH:MM": (v) => {
    if (!/^\d{1,2}:\d{2}$/.test(v)) return `Expected HH:MM, got "${v}"`;
    const [h, m] = v.split(":").map(Number);
    if (h < 0 || h > 23) return `Hours must be 0-23, got ${h}`;
    if (m < 0 || m > 59) return `Minutes must be 0-59, got ${m}`;
    return null;
  },
  "YYYY-MM-DD": (v) => {
    // Strict: rejects impossible days like 2026-02-30 (new Date() would roll over).
    if (!isValidYMD(v)) return `Expected a valid YYYY-MM-DD date, got "${v}"`;
    return null;
  },
  ISO8601: (v) => {
    // Accept common ISO 8601 variants: with/without seconds, with/without timezone
    const d = new Date(v);
    if (isNaN(d.getTime())) return `Invalid ISO 8601 datetime: "${v}"`;
    return null;
  },
};

function validateParams(
  tool: string,
  params: Record<string, unknown>,
): string | null {
  const def = MVP_TOOLS.find((t) => t.name === tool);
  if (!def) return `Unknown tool: ${tool}`;

  // Validate required params exist and have correct type
  for (const req of def.parameters.required) {
    if (params[req] === undefined || params[req] === null) {
      return `Missing required parameter: ${req}`;
    }
    const prop = def.parameters.properties[req];
    if (prop?.type === "string" && typeof params[req] !== "string") {
      return `Parameter "${req}" must be a string, got ${typeof params[req]}`;
    }
    if (prop?.type === "number" && typeof params[req] !== "number") {
      return `Parameter "${req}" must be a number, got ${typeof params[req]}`;
    }
  }

  // Validate format constraints on all provided string params
  for (const [key, prop] of Object.entries(def.parameters.properties)) {
    const value = params[key];
    if (value === undefined || value === null || typeof value !== "string") continue;
    if (prop.format && FORMAT_VALIDATORS[prop.format]) {
      const formatError = FORMAT_VALIDATORS[prop.format](value);
      if (formatError) return `Parameter "${key}": ${formatError}`;
    }
  }

  return null;
}

export async function dispatchToolCall(
  tool: string,
  parameters: Record<string, unknown>,
  lang: Language = "en",
): Promise<ToolCallResult> {
  const validationError = validateParams(tool, parameters);
  if (validationError) {
    return { success: false, message: "Invalid parameters", error: validationError };
  }

  try {
    switch (tool) {
      case "set_alarm":
        return await setAlarm(
          parameters.time as string,
          parameters.date as string | undefined,
          parameters.label as string | undefined,
        );

      case "create_event":
        return await createEvent(
          parameters.title as string,
          parameters.start as string,
          parameters.end as string | undefined,
          parameters.location as string | undefined,
        );

      case "set_reminder":
        // Schedules a real local notification (offline), not a calendar insert.
        return await scheduleReminder(
          parameters.text as string,
          parameters.datetime as string,
        );

      case "set_timer":
        return await setTimer(
          parameters.minutes as number,
          parameters.label as string | undefined,
        );

      case "navigate_to":
        return await navigateTo(parameters.destination as string);

      case "search_contacts":
        return await searchContacts(parameters.query as string, lang);

      case "make_call":
        return await makeCall(parameters.contact as string, lang);

      case "send_sms":
        return await sendSms(
          parameters.contact as string,
          parameters.text as string,
          lang,
        );

      case "get_calendar_events":
        return await getCalendarEvents(parameters.date as string, lang);

      case "query_document":
        return await queryDocuments(parameters.query as string, lang);

      case "general_chat":
        return { success: true, message: "OK" };

      default:
        return {
          success: false,
          message: `Unknown tool: ${tool}`,
          error: `Tool "${tool}" is not registered`,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message: "Action failed", error: message };
  }
}
