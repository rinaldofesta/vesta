// System Actions — TypeScript bridge to native Android modules.
// Each function calls a Kotlin native module via NativeModules/expo-modules.
// The native side fires Android Intents (SET_ALARM, INSERT calendar event, etc.)

import { NativeModules, Platform } from "react-native";
import type { ToolCallResult } from "../orchestrator/types";

const { SystemActionsModule } = NativeModules;

const isAvailable =
  Platform.OS === "android" && !!SystemActionsModule;

function ensureAvailable(): void {
  if (!isAvailable) {
    throw new Error(
      "System actions require Android with the native module loaded",
    );
  }
}

export async function setAlarm(
  time: string,
  date?: string,
  label?: string,
): Promise<ToolCallResult> {
  ensureAvailable();

  const [hours, minutes] = time.split(":").map(Number);
  if (isNaN(hours) || isNaN(minutes)) {
    return { success: false, message: "Invalid time format", error: `Expected HH:MM, got "${time}"` };
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return { success: false, message: "Time out of range", error: `Hours must be 0-23, minutes 0-59, got ${hours}:${minutes}` };
  }

  try {
    // NOTE: Android's AlarmClock.ACTION_SET_ALARM ignores the date parameter.
    // Alarms are always set for the next occurrence of the given time.
    await SystemActionsModule.setAlarm(hours, minutes, label || "", date || "");
    return { success: true, message: `Alarm set for ${time}${date ? ` on ${date}` : ""}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: "Failed to set alarm", error: msg };
  }
}

export async function createEvent(
  title: string,
  start: string,
  end?: string,
  location?: string,
): Promise<ToolCallResult> {
  ensureAvailable();

  try {
    await SystemActionsModule.createCalendarEvent(
      title,
      start,
      end || "",
      location || "",
    );
    return { success: true, message: `Event "${title}" created` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: "Failed to create event", error: msg };
  }
}

export async function setReminder(
  text: string,
  datetime: string,
): Promise<ToolCallResult> {
  ensureAvailable();

  try {
    await SystemActionsModule.setReminder(text, datetime);
    return { success: true, message: `Reminder set: "${text}"` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: "Failed to set reminder", error: msg };
  }
}
