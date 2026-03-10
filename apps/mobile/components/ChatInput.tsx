import { useState, useRef, useImperativeHandle, forwardRef } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing } from "../lib/theme";

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
}

export interface ChatInputHandle {
  focus: () => void;
  setText: (text: string) => void;
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(
  function ChatInput({ onSend, disabled }, ref) {
    const [text, setText] = useState("");
    const insets = useSafeAreaInsets();
    const inputRef = useRef<TextInput>(null);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      setText: (t: string) => setText(t),
    }));

    const handleSend = () => {
      const trimmed = text.trim();
      if (!trimmed || disabled) return;
      onSend(trimmed);
      setText("");
    };

    const canSend = text.trim().length > 0 && !disabled;

    return (
      <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Message Vesta..."
            placeholderTextColor={colors.textPlaceholder}
            value={text}
            onChangeText={setText}
            onSubmitEditing={handleSend}
            editable={!disabled}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!canSend}
            activeOpacity={0.7}
          >
            <Text style={[styles.sendText, !canSend && styles.sendTextDisabled]}>↑</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radii.xl,
    paddingHorizontal: 18,
    paddingTop: 11,
    paddingBottom: 11,
    color: colors.textPrimary,
    fontSize: 16,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    marginLeft: 10,
    marginBottom: 2,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    backgroundColor: colors.disabled,
  },
  sendText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  sendTextDisabled: {
    color: colors.textPlaceholder,
  },
});
