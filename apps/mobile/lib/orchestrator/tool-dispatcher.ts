// Tool Dispatcher — routes parsed tool calls to native module actions.
// In Fase 1, tools map to Android Intents via SystemActionsModule.

import type { ToolCallResult } from "./types";
import { MVP_TOOLS } from "../tools/tool-registry";
import {
  setAlarm,
  createEvent,
  setReminder,
} from "../native/system-actions";

function validateParams(
  tool: string,
  params: Record<string, unknown>,
): string | null {
  const def = MVP_TOOLS.find((t) => t.name === tool);
  if (!def) return `Unknown tool: ${tool}`;

  for (const req of def.parameters.required) {
    if (params[req] === undefined || params[req] === null) {
      return `Missing required parameter: ${req}`;
    }
    const expectedType = def.parameters.properties[req]?.type;
    if (expectedType === "string" && typeof params[req] !== "string") {
      return `Parameter "${req}" must be a string, got ${typeof params[req]}`;
    }
    if (expectedType === "number" && typeof params[req] !== "number") {
      return `Parameter "${req}" must be a number, got ${typeof params[req]}`;
    }
  }
  return null;
}

export async function dispatchToolCall(
  tool: string,
  parameters: Record<string, unknown>,
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
        return await setReminder(
          parameters.text as string,
          parameters.datetime as string,
        );

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
