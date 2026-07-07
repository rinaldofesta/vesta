import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState, useEffect } from "react";
import {
  View,
  ActivityIndicator,
  AppState,
  NativeEventEmitter,
  NativeModules,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useChatStore } from "../lib/store/chat-store";
import { unloadEmbeddingModel, isEmbeddingLoaded } from "../lib/llm/embed-engine";
import { colors } from "../lib/theme";

export default function RootLayout() {
  const init = useChatStore((s) => s.init);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    init()
      .catch((err) => console.error("Init failed:", err))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    // Reclaim the embedding model's RAM when the app is backgrounded; it
    // lazy-reloads on the next document import/query.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        unloadEmbeddingModel().catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // Android low-memory pressure. RN's AppState `memoryWarning` never fires on
    // Android, so SystemActionsModule hooks native onTrimMemory and forwards it
    // here (already filtered to real pressure). We drop only the cheap-to-rebuild
    // embedding context (~1s to reload); the chat model stays resident by design
    // (ADR-016) — if the OS still kills us, the foreground service restarts and
    // the prefix session cache makes the cold start cheap.
    const mod = NativeModules.SystemActionsModule;
    if (!mod) return;
    const emitter = new NativeEventEmitter(mod);
    const sub = emitter.addListener("memoryWarning", (level: number) => {
      if (isEmbeddingLoaded()) {
        console.log(`[MemoryPressure] releasing embed context (trim level ${level})`);
      }
      unloadEmbeddingModel().catch(() => {});
    });
    return () => sub.remove();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontWeight: "600", fontSize: 17 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: "Vesta" }}
        />
        <Stack.Screen
          name="history"
          options={{ title: "Conversations" }}
        />
        <Stack.Screen
          name="settings"
          options={{ title: "Settings" }}
        />
        <Stack.Screen
          name="models"
          options={{ title: "Models" }}
        />
        <Stack.Screen
          name="documents"
          options={{ title: "Documents" }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
