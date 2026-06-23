// Device capability hints used to label/gate model choices.
//
// Total RAM + device model come from a tiny native getter (Android
// ActivityManager). Free disk comes from expo-file-system. When the native
// module is unavailable (iOS / Expo Go), totalRamMb stays null and the UI
// labels without hard-gating — ramFit() already treats null as "unknown".

import { getFreeBytes } from "./download-manager";
import { getDeviceInfo } from "../native/system-actions";

export interface DeviceCaps {
  freeBytes: number;
  totalRamMb: number | null;
  deviceName: string | null;
}

export async function getDeviceCaps(): Promise<DeviceCaps> {
  const [freeBytes, info] = await Promise.all([getFreeBytes(), getDeviceInfo()]);
  const deviceName = info
    ? [info.manufacturer, info.model].filter(Boolean).join(" ").trim() || null
    : null;
  return {
    freeBytes,
    totalRamMb: info ? Math.round(info.totalMemMb) : null,
    deviceName,
  };
}
