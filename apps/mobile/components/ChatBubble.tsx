import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Message } from "../lib/orchestrator/types";

interface Props {
  message: Message;
}

export const ChatBubble = React.memo(function ChatBubble({ message }: Props) {
  const isUser = message.role === "user";

  const toolCall = useMemo(() => {
    if (!message.toolCall) return null;
    try { return JSON.parse(message.toolCall); }
    catch { return null; }
  }, [message.toolCall]);

  const toolResult = useMemo(() => {
    if (!message.toolResult) return null;
    try { return JSON.parse(message.toolResult); }
    catch { return null; }
  }, [message.toolResult]);

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <Text style={[styles.text, isUser ? styles.textUser : styles.textAssistant]}>
          {message.content}
        </Text>
        {toolCall && (
          <View style={styles.toolTag}>
            <Text style={styles.toolTagText}>
              {toolCall.tool}
              {toolResult?.success ? " ✓" : toolResult ? " ✗" : ""}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 12,
    marginVertical: 4,
  },
  rowUser: {
    alignItems: "flex-end",
  },
  rowAssistant: {
    alignItems: "flex-start",
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: "#0f3460",
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: "#1a1a2e",
    borderBottomLeftRadius: 4,
  },
  text: {
    fontSize: 15,
    lineHeight: 21,
  },
  textUser: {
    color: "#e0e0e0",
  },
  textAssistant: {
    color: "#c8c8c8",
  },
  toolTag: {
    marginTop: 6,
    backgroundColor: "#e94560",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  toolTagText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
});
