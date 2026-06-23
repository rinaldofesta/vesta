// Reminders via expo-notifications — schedules a real local notification that
// fires at the requested time, fully offline (Android AlarmManager under the
// hood). This replaces the old calendar-insert approach, which did not reliably
// alert. No native code needed; POST_NOTIFICATIONS is already declared.

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { ToolCallResult } from "../orchestrator/types";

const CHANNEL_ID = "reminders";
let configured = false;

async function ensureConfigured(): Promise<void> {
  if (configured) return;
  // Show reminders even when the app is foregrounded.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Reminders",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  configured = true;
}

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function scheduleReminder(
  text: string,
  datetime: string,
): Promise<ToolCallResult> {
  const when = new Date(datetime);
  if (isNaN(when.getTime())) {
    return {
      success: false,
      message: "Invalid reminder time",
      error: `Could not parse datetime "${datetime}"`,
    };
  }
  // Allow a small grace window for "now"-ish times; reject genuine past times.
  if (when.getTime() <= Date.now() + 1000) {
    return {
      success: false,
      message: "That time has already passed",
      error: "Reminder time must be in the future",
    };
  }

  try {
    await ensureConfigured();
    if (!(await ensurePermission())) {
      return {
        success: false,
        message: "Notifications are turned off",
        error: "Enable notifications to use reminders.",
      };
    }
    await Notifications.scheduleNotificationAsync({
      content: { title: "Vesta reminder", body: text, sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
        channelId: CHANNEL_ID,
      },
    });
    return { success: true, message: `Reminder set: "${text}"` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message: "Failed to set reminder", error: message };
  }
}
