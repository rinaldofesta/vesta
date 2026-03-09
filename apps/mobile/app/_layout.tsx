import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState, useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useChatStore } from "../lib/store/chat-store";

export default function RootLayout() {
  const init = useChatStore((s) => s.init);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    init()
      .catch((err) => console.error("Init failed:", err))
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: "#16213e", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#e94560" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#1a1a2e" },
          headerTintColor: "#e0e0e0",
          contentStyle: { backgroundColor: "#16213e" },
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: "Vesta" }}
        />
        <Stack.Screen
          name="settings"
          options={{ title: "Settings" }}
        />
      </Stack>
    </>
  );
}
