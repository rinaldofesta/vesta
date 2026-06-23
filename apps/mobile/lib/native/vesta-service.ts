// Vesta Service — TypeScript bridge to the Android foreground service.
// Keeps the app process alive so Android doesn't kill the LLM while in background.

import { NativeModules, Platform } from "react-native";

const { VestaServiceModule } = NativeModules;

const isAvailable =
  Platform.OS === "android" && !!VestaServiceModule;

export async function startVestaService(): Promise<void> {
  if (!isAvailable) return;
  await VestaServiceModule.startService();
}

export async function stopVestaService(): Promise<void> {
  if (!isAvailable) return;
  await VestaServiceModule.stopService();
}

export async function updateServiceNotification(
  status: string,
): Promise<void> {
  if (!isAvailable) return;
  await VestaServiceModule.updateNotification(status);
}
