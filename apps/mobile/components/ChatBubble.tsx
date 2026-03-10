import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import type { Message } from "../lib/orchestrator/types";
import { colors, radii, typography } from "../lib/theme";

interface Props {
  message: Message;
}

/** Split text into thinking and visible content parts. */
function parseThinking(text: string): {
  thinking: string | null;
  content: string;
} {
  // Matched pair: <think>...</think>
  const matched = text.match(/<think>([\s\S]*?)<\/think>/);
  if (matched) {
    const thinking = matched[1].trim() || null;
    const content = text.replace(/<think>[\s\S]*?<\/think>/, "").trim();
    return { thinking, content };
  }
  // Orphan close tag (model started thinking before capture)
  const orphanEnd = text.lastIndexOf("</think>");
  if (orphanEnd !== -1) {
    const content = text.substring(orphanEnd + "</think>".length).trim();
    return { thinking: null, content };
  }
  return { thinking: null, content: text };
}

export const ChatBubble = React.memo(function ChatBubble({ message }: Props) {
  const isUser = message.role === "user";
  const [thinkExpanded, setThinkExpanded] = useState(false);

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

  const { thinking, content } = useMemo(
    () => (isUser ? { thinking: null, content: message.content } : parseThinking(message.content)),
    [message.content, isUser],
  );

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
        ]}
      >
        {/* Thinking block */}
        {thinking && (
          <View style={styles.thinkBlock}>
            <TouchableOpacity
              onPress={() => setThinkExpanded((v) => !v)}
              activeOpacity={0.7}
            >
              <Text style={styles.thinkLabel}>
                {thinkExpanded ? "▾ Thinking" : "▸ Thinking..."}
              </Text>
            </TouchableOpacity>
            {thinkExpanded && (
              <Text style={styles.thinkText}>{thinking}</Text>
            )}
          </View>
        )}

        {/* Main content */}
        {content ? (
          <Text
            style={[styles.text, isUser ? styles.textUser : styles.textAssistant]}
          >
            {content}
          </Text>
        ) : null}

        {/* Tool badge */}
        {toolCall && (
          <View
            style={[
              styles.toolBadge,
              toolResult?.success ? styles.toolSuccess : toolResult ? styles.toolError : styles.toolPending,
            ]}
          >
            <Text style={[
              styles.toolBadgeText,
              toolResult?.success ? styles.toolSuccessText : toolResult ? styles.toolErrorText : styles.toolPendingText,
            ]}>
              {toolCall.tool?.replace(/_/g, " ")}
              {toolResult?.success ? "  ✓" : toolResult ? "  ✗" : ""}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
});

export function StreamingBubble({ text }: { text: string }) {
  const { thinking, content } = parseThinking(text);

  return (
    <View style={[styles.row, styles.rowAssistant]}>
      <View style={[styles.bubble, styles.bubbleAssistant]}>
        {thinking && (
          <View style={styles.thinkBlock}>
            <Text style={styles.thinkLabel}>▾ Thinking</Text>
            <Text style={styles.thinkText}>{thinking}</Text>
          </View>
        )}
        <Text style={[styles.text, styles.textAssistant]}>
          {content || "..."}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    marginVertical: 4,
  },
  rowUser: {
    alignItems: "flex-end",
  },
  rowAssistant: {
    alignItems: "flex-start",
  },
  bubble: {
    maxWidth: "82%",
    borderRadius: radii.lg,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  bubbleUser: {
    backgroundColor: colors.userBubble,
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: colors.assistantBubble,
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  text: {
    ...typography.body,
  },
  textUser: {
    color: colors.userText,
  },
  textAssistant: {
    color: colors.assistantText,
  },
  // Thinking block
  thinkBlock: {
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  thinkLabel: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  thinkText: {
    color: colors.textMuted,
    ...typography.bodySmall,
    fontStyle: "italic",
  },
  // Tool badge
  toolBadge: {
    marginTop: 8,
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: "flex-start",
  },
  toolSuccess: {
    backgroundColor: colors.successBg,
  },
  toolError: {
    backgroundColor: colors.errorBg,
  },
  toolPending: {
    backgroundColor: colors.accentMuted,
  },
  toolBadgeText: {
    ...typography.caption,
    fontWeight: "600",
  },
  toolSuccessText: {
    color: colors.success,
  },
  toolErrorText: {
    color: colors.error,
  },
  toolPendingText: {
    color: colors.accent,
  },
});
