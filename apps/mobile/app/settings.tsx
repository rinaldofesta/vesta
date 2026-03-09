import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useChatStore } from "../lib/store/chat-store";
import { loadModel, unloadModel } from "../lib/llm/llm-engine";
import type { Language } from "../lib/orchestrator/types";

export default function SettingsScreen() {
  const language = useChatStore((s) => s.language);
  const modelLoaded = useChatStore((s) => s.modelLoaded);
  const modelPath = useChatStore((s) => s.modelPath);
  const setLanguage = useChatStore((s) => s.setLanguage);
  const updateModelStatus = useChatStore((s) => s.updateModelStatus);

  const [loadProgress, setLoadProgress] = useState<number | null>(null);

  const handlePickModel = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: false,
      });

      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const name = asset.name ?? "";
      if (!name.endsWith(".gguf")) {
        Alert.alert("Invalid file", "Please select a .gguf model file.");
        return;
      }
      const uri = asset.uri;

      setLoadProgress(0);
      await loadModel(uri, { contextSize: 4096, gpuLayers: 0 }, (progress) => {
        setLoadProgress(progress);
      });
      setLoadProgress(null);
      updateModelStatus();
    } catch (err) {
      setLoadProgress(null);
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert("Error", `Failed to load model: ${msg}`);
    }
  };

  const handleUnload = async () => {
    try {
      await unloadModel();
      updateModelStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert("Error", `Failed to unload model: ${msg}`);
    }
  };

  const toggleLanguage = () => {
    const next: Language = language === "it" ? "en" : "it";
    setLanguage(next);
  };

  const shortPath = modelPath
    ? modelPath.split("/").pop() || modelPath
    : "None";

  return (
    <View style={styles.container}>
      {/* Model section */}
      <Text style={styles.sectionTitle}>Model</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Status</Text>
        <Text style={[styles.value, modelLoaded ? styles.loaded : styles.notLoaded]}>
          {modelLoaded ? "Loaded" : "Not loaded"}
        </Text>

        {modelLoaded && (
          <>
            <Text style={styles.label}>File</Text>
            <Text style={styles.value} numberOfLines={1}>
              {shortPath}
            </Text>
          </>
        )}

        {loadProgress !== null && (
          <View style={styles.progressRow}>
            <ActivityIndicator color="#e94560" size="small" />
            <Text style={styles.progressText}>
              Loading... {Math.round(loadProgress)}%
            </Text>
          </View>
        )}

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={styles.btn}
            onPress={handlePickModel}
            disabled={loadProgress !== null}
          >
            <Text style={styles.btnText}>
              {modelLoaded ? "Change Model" : "Load Model"}
            </Text>
          </TouchableOpacity>

          {modelLoaded && (
            <TouchableOpacity
              style={[styles.btn, styles.btnDanger]}
              onPress={handleUnload}
            >
              <Text style={styles.btnText}>Unload</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Language section */}
      <Text style={styles.sectionTitle}>Language</Text>
      <View style={styles.card}>
        <TouchableOpacity style={styles.langBtn} onPress={toggleLanguage}>
          <Text style={styles.langText}>
            {language === "it" ? "Italiano" : "English"}
          </Text>
          <Text style={styles.langHint}>Tap to switch</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#16213e",
    padding: 16,
  },
  sectionTitle: {
    color: "#e94560",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 16,
  },
  card: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 16,
  },
  label: {
    color: "#888",
    fontSize: 12,
    marginBottom: 2,
  },
  value: {
    color: "#e0e0e0",
    fontSize: 15,
    marginBottom: 12,
  },
  loaded: {
    color: "#2ecc71",
    fontWeight: "600",
  },
  notLoaded: {
    color: "#e94560",
    fontWeight: "600",
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  },
  progressText: {
    color: "#999",
    fontSize: 13,
  },
  btnRow: {
    flexDirection: "row",
    gap: 12,
  },
  btn: {
    backgroundColor: "#0f3460",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  btnDanger: {
    backgroundColor: "#c0392b",
  },
  btnText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  langBtn: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  langText: {
    color: "#e0e0e0",
    fontSize: 18,
    fontWeight: "600",
  },
  langHint: {
    color: "#666",
    fontSize: 13,
  },
});
