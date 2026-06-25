// System Actions — TypeScript bridge to native Android modules.
// Each function calls a Kotlin native module via NativeModules/expo-modules.
// The native side fires Android Intents (SET_ALARM, INSERT calendar event, etc.)

import { NativeModules, Platform, Linking } from "react-native";
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

export async function setTimer(
  minutes: number,
  label?: string,
): Promise<ToolCallResult> {
  ensureAvailable();

  if (!Number.isFinite(minutes) || minutes <= 0) {
    return {
      success: false,
      message: "Invalid timer duration",
      error: `Minutes must be greater than 0, got ${minutes}`,
    };
  }

  try {
    await SystemActionsModule.setTimer(Math.round(minutes * 60), label || "");
    const unit = minutes === 1 ? "minute" : "minutes";
    return {
      success: true,
      message: `Timer set for ${minutes} ${unit}${label ? ` (${label})` : ""}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: "Failed to set timer", error: msg };
  }
}

// Opens turn-by-turn navigation in the maps app. Uses the standard
// `google.navigation:` intent, falling back to a generic `geo:` search when
// no navigation-capable app is registered. Built on RN Linking — no native
// module or special permission required.
export async function navigateTo(destination: string): Promise<ToolCallResult> {
  const dest = destination?.trim();
  if (!dest) {
    return {
      success: false,
      message: "Missing destination",
      error: "destination is empty",
    };
  }

  const navUrl = `google.navigation:q=${encodeURIComponent(dest)}`;
  const geoUrl = `geo:0,0?q=${encodeURIComponent(dest)}`;
  try {
    if (await Linking.canOpenURL(navUrl)) {
      await Linking.openURL(navUrl);
    } else {
      await Linking.openURL(geoUrl);
    }
    return { success: true, message: `Navigating to ${dest}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: "Failed to start navigation", error: msg };
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

export interface NativeDeviceInfo {
  totalMemMb: number;
  availMemMb: number;
  lowRam: boolean;
  model: string | null;
  manufacturer: string | null;
}

// Returns device RAM + model, or null when the native module isn't available
// (iOS / Expo Go). Callers must treat null as "unknown" and not hard-gate.
export async function getDeviceInfo(): Promise<NativeDeviceInfo | null> {
  if (!isAvailable || typeof SystemActionsModule.getDeviceInfo !== "function") {
    return null;
  }
  try {
    return (await SystemActionsModule.getDeviceInfo()) as NativeDeviceInfo;
  } catch {
    return null;
  }
}

// NOTE: reminders are now scheduled as real local notifications via
// lib/native/reminders.ts (offline, reliably alerting). The old native
// calendar-insert path was removed because ACTION_INSERT did not honor the
// reminder alarm.
