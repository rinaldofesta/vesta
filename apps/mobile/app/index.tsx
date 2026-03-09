import React, { useRef, useEffect } from "react";
import {
  View,
  FlatList,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useChatStore } from "../lib/store/chat-store";
import { ChatBubble } from "../components/ChatBubble";
import { ChatInput } from "../components/ChatInput";
import type { Message } from "../lib/orchestrator/types";

const StreamingFooter = React.memo(function StreamingFooter({
  isGenerating,
  streamingText,
}: {
  isGenerating: boolean;
  streamingText: string;
}) {
  if (!isGenerating) return null;
  return (
    <View style={[styles.row, styles.rowAssistant]}>
      <View style={styles.streamBubble}>
        <Text style={styles.streamText}>{streamingText || "..."}</Text>
      </View>
    </View>
  );
});

export default function ChatScreen() {
  const router = useRouter();
  const flatListRef = useRef<FlatList<Message>>(null);
  const lastScrollRef = useRef(0);

  const messages = useChatStore((s) => s.messages);
  const isGenerating = useChatStore((s) => s.isGenerating);
  const streamingText = useChatStore((s) => s.streamingText);
  const modelLoaded = useChatStore((s) => s.modelLoaded);
  const error = useChatStore((s) => s.error);
  const sendMessage = useChatStore((s) => s.sendMessage);

  // Scroll on new complete messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  // Throttled scroll during streaming (max once per 500ms)
  useEffect(() => {
    if (isGenerating && streamingText) {
      const now = Date.now();
      if (now - lastScrollRef.current > 500) {
        lastScrollRef.current = now;
        flatListRef.current?.scrollToEnd({ animated: false });
      }
    }
  }, [isGenerating, streamingText]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      {!modelLoaded && (
        <TouchableOpacity
          style={styles.banner}
          onPress={() => router.push("/settings")}
        >
          <Text style={styles.bannerText}>
            No model loaded. Tap to load a model.
          </Text>
        </TouchableOpacity>
      )}

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ChatBubble message={item} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Vesta</Text>
            <Text style={styles.emptySubtitle}>
              Intelligence that never leaves home.
            </Text>
          </View>
        }
        ListFooterComponent={
          <StreamingFooter isGenerating={isGenerating} streamingText={streamingText} />
        }
      />

      <ChatInput onSend={sendMessage} disabled={isGenerating || !modelLoaded} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#16213e",
  },
  banner: {
    backgroundColor: "#e94560",
    padding: 12,
    alignItems: "center",
  },
  bannerText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  errorBanner: {
    backgroundColor: "#c0392b",
    padding: 8,
    alignItems: "center",
  },
  errorText: {
    color: "#fff",
    fontSize: 13,
  },
  list: {
    paddingVertical: 8,
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 120,
  },
  emptyTitle: {
    color: "#e94560",
    fontSize: 32,
    fontWeight: "bold",
  },
  emptySubtitle: {
    color: "#666",
    fontSize: 14,
    marginTop: 8,
    fontStyle: "italic",
  },
  row: {
    paddingHorizontal: 12,
    marginVertical: 4,
  },
  rowAssistant: {
    alignItems: "flex-start",
  },
  streamBubble: {
    maxWidth: "80%",
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  streamText: {
    color: "#999",
    fontSize: 15,
    lineHeight: 21,
  },
});
