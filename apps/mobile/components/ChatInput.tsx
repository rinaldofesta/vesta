import { useState } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
} from "react-native";

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: Props) {
  const [text, setText] = useState("");

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Message Vesta..."
        placeholderTextColor="#666"
        value={text}
        onChangeText={setText}
        onSubmitEditing={handleSend}
        editable={!disabled}
        multiline
        maxLength={1000}
      />
      <TouchableOpacity
        style={[styles.sendBtn, (!text.trim() || disabled) && styles.sendBtnDisabled]}
        onPress={handleSend}
        disabled={!text.trim() || disabled}
      >
        <Text style={styles.sendText}>↑</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 8,
    paddingBottom: 12,
    backgroundColor: "#1a1a2e",
    borderTopWidth: 1,
    borderTopColor: "#2a2a4a",
  },
  input: {
    flex: 1,
    backgroundColor: "#16213e",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: "#e0e0e0",
    fontSize: 15,
    maxHeight: 100,
  },
  sendBtn: {
    marginLeft: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e94560",
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    backgroundColor: "#444",
  },
  sendText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
});
