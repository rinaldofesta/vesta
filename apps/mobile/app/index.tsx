import React, { useRef, useEffect, useState, useLayoutEffect } from "react";
import {
  View,
  FlatList,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Linking,
} from "react-native";
import { useRouter, useNavigation } from "expo-router";
import { useChatStore } from "../lib/store/chat-store";
import { ChatBubble, StreamingBubble } from "../components/ChatBubble";
import { ChatInput } from "../components/ChatInput";
import type { ChatInputHandle } from "../components/ChatInput";
import { FlameIndicator } from "../components/FlameIndicator";
import { colors, spacing, typography, radii } from "../lib/theme";
import type { Message } from "../lib/orchestrator/types";

const StreamingFooter = React.memo(function StreamingFooter({
  isGenerating,
  streamingText,
}: {
  isGenerating: boolean;
  streamingText: string;
}) {
  if (!isGenerating) return null;

  // Show flame indicator when waiting for first token, streaming bubble once text arrives
  if (!streamingText) return <FlameIndicator />;
  return <StreamingBubble text={streamingText} />;
});

/** Hook: track keyboard height on Android via Keyboard events. */
function useKeyboardHeight() {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}

export default function ChatScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const flatListRef = useRef<FlatList<Message>>(null);
  const lastScrollRef = useRef(0);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const keyboardHeight = useKeyboardHeight();
  const handledUrlRef = useRef<string | null>(null);

  const messages = useChatStore((s) => s.messages);
  const isGenerating = useChatStore((s) => s.isGenerating);
  const streamingText = useChatStore((s) => s.streamingText);
  const modelLoaded = useChatStore((s) => s.modelLoaded);
  const error = useChatStore((s) => s.error);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const conversationTitle = useChatStore((s) => s.conversationTitle);
  const clearConversation = useChatStore((s) => s.clearConversation);

  // Dynamic header with history + new chat buttons
  useLayoutEffect(() => {
    navigation.setOptions({
      title: conversationTitle || "Vesta",
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => router.push("/history")}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.headerBtnText}>&#9776;</Text>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={clearConversation}
            style={styles.headerBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.headerBtnText}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/settings")}
            style={styles.headerBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.headerBtnText}>&#9881;</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, conversationTitle, clearConversation]);

  // Handle deep links from widget (voice text or focus request)
  const handleDeepLink = (url: string) => {
    if (!url || url === handledUrlRef.current) return;
    handledUrlRef.current = url;

    try {
      const parsed = new URL(url);
      if (parsed.hostname === "chat" || parsed.pathname === "/chat") {
        const voiceText = parsed.searchParams.get("voice_text");
        const focus = parsed.searchParams.get("focus");

        if (voiceText && modelLoaded) {
          // Auto-send voice transcription
          setTimeout(() => sendMessage(voiceText), 300);
        } else if (focus) {
          // Focus the input
          setTimeout(() => chatInputRef.current?.focus(), 300);
        }
      }
    } catch {}
  };

  // Check initial URL (cold launch from widget)
  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url);
    });
  }, [modelLoaded]);

  // Listen for new URLs (warm launch from widget)
  useEffect(() => {
    const sub = Linking.addEventListener("url", ({ url }) => handleDeepLink(url));
    return () => sub.remove();
  }, [modelLoaded]);

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

  // Scroll when keyboard opens
  useEffect(() => {
    if (keyboardHeight > 0 && messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [keyboardHeight]);

  const chatContent = (
    <>
      {!modelLoaded && (
        <TouchableOpacity
          style={styles.banner}
          onPress={() => router.push("/settings")}
          activeOpacity={0.8}
        >
          <Text style={styles.bannerText}>
            No model loaded — tap to configure
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
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.logoCircle}>
              <Image
                source={require("../assets/brand/vesta-flame-logo-1024x1024.png")}
                style={styles.logoImage}
              />
            </View>
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

      <ChatInput ref={chatInputRef} onSend={sendMessage} disabled={isGenerating || !modelLoaded} />
    </>
  );

  // Android: manually pad for keyboard since adjustResize may not work in dev client
  if (Platform.OS === "android") {
    return (
      <View style={[styles.container, { paddingBottom: keyboardHeight }]}>
        {chatContent}
      </View>
    );
  }

  // iOS: standard KeyboardAvoidingView
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={90}
    >
      {chatContent}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  banner: {
    backgroundColor: colors.accentSoft,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bannerText: {
    color: colors.accent,
    fontWeight: "600",
    fontSize: 14,
  },
  errorBanner: {
    backgroundColor: colors.errorBg,
    paddingVertical: 8,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.error,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: "500",
  },
  list: {
    paddingVertical: spacing.md,
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 120,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  logoImage: {
    width: 40,
    height: 40,
    resizeMode: "contain",
  },
  emptyTitle: {
    color: colors.textPrimary,
    ...typography.heading,
  },
  emptySubtitle: {
    color: colors.textMuted,
    fontSize: 15,
    marginTop: 8,
    fontStyle: "italic",
  },
  // Header buttons
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 4,
  },
  headerBtnText: {
    fontSize: 18,
    color: colors.accent,
    fontWeight: "600",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
});
