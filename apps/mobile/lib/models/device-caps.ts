// Device capability hints used to label/gate model choices.
//
// Free disk space is available cross-platform via expo-file-system. Total RAM
// has no built-in RN/Expo API — until a tiny native getter (or
// react-native-device-info) is added, totalRamMb stays null and the UI labels
// RAM requirements without hard-gating. ramFit() already treats null as
// "unknown" so nothing breaks when this is filled in later.

import { getFreeBytes } from "./download-manager";

export interface DeviceCaps {
  freeBytes: number;
  totalRamMb: number | null;
}

export async function getDeviceCaps(): Promise<DeviceCaps> {
  const freeBytes = await getFreeBytes();
  return { freeBytes, totalRamMb: null };
}
