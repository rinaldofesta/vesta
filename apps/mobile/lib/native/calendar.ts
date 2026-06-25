// Calendar read access via expo-calendar. Handles the READ_CALENDAR runtime
// permission and returns events for a day as data for the model to summarize.

import * as Calendar from "expo-calendar";
import type { ToolCallResult, Language } from "../orchestrator/types";
import { isValidYMD } from "../orchestrator/date-utils";

async function hasCalendarPermission(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === "granted";
}

// Reads events for a single local day (YYYY-MM-DD), across all event calendars,
// and returns them as ToolCallResult.data for a natural-language answer.
// Only the failure messages are user-facing (success feeds a follow-up answer).
export async function getCalendarEvents(
  date: string,
  lang: Language,
): Promise<ToolCallResult> {
  if (!isValidYMD(date)) {
    return {
      success: false,
      message: lang === "it" ? "Data non valida." : "Invalid date.",
      error: `Expected YYYY-MM-DD, got "${date}"`,
    };
  }

  if (!(await hasCalendarPermission())) {
    return {
      success: false,
      message:
        lang === "it"
          ? "Mi servono i permessi per accedere al calendario."
          : "I need permission to read your calendar.",
    };
  }

  try {
    const [y, m, d] = date.split("-").map(Number);
    const start = new Date(y, m - 1, d, 0, 0, 0, 0);
    // Up to the start of the next day so all-day events (which end at the next
    // midnight) are included — Android only returns events ending <= endDate.
    const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

    const calendars = await Calendar.getCalendarsAsync(
      Calendar.EntityTypes.EVENT,
    );
    const ids = calendars.map((c) => c.id);
    if (ids.length === 0) {
      return { success: true, message: "No calendars found", data: JSON.stringify([]) };
    }

    const events = await Calendar.getEventsAsync(ids, start, end);
    const shaped = events
      .map((e) => ({
        title: e.title ?? "(no title)",
        start: e.startDate,
        end: e.endDate,
        location: e.location || undefined,
        allDay: e.allDay || undefined,
      }))
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));

    return {
      success: true,
      message: `${shaped.length} event(s) on ${date}`,
      data: JSON.stringify(shaped),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message:
        lang === "it" ? "Lettura calendario non riuscita." : "Failed to read the calendar.",
      error: msg,
    };
  }
}
