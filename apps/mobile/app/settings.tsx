import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Switch,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { useChatStore } from "../lib/store/chat-store";
import {
  importKnowledgeFile,
  removeKnowledgeFile,
  listKnowledgeFiles,
  KnowledgeTooLargeError,
} from "../lib/orchestrator/knowledge-manager";
import { getConfig, setConfig } from "../lib/storage/database";
import type { KnowledgeFile } from "../lib/storage/database";
import { colors, spacing, radii, typography } from "../lib/theme";
import type { Language } from "../lib/orchestrator/types";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SettingsScreen() {
  const router = useRouter();
  const language = useChatStore((s) => s.language);
  const modelLoaded = useChatStore((s) => s.modelLoaded);
  const modelPath = useChatStore((s) => s.modelPath);
  const setLanguage = useChatStore((s) => s.setLanguage);

  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);
  const [confirmActions, setConfirmActions] = useState(true);

  useEffect(() => {
    getConfig("confirm_destructive_actions")
      .then((v) => setConfirmActions(v !== "false"))
      .catch(() => {});
  }, []);

  const toggleConfirmActions = (value: boolean) => {
    setConfirmActions(value);
    setConfig("confirm_destructive_actions", value ? "true" : "false").catch(() => {});
  };

  const refreshKnowledgeFiles = useCallback(async () => {
    try {
      const files = await listKnowledgeFiles();
      setKnowledgeFiles(files);
    } catch (err) {
      console.warn("Failed to load knowledge files:", err);
    }
  }, []);

  useEffect(() => {
    refreshKnowledgeFiles();
  }, [refreshKnowledgeFiles]);

  const handleAddKnowledgeFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "text/*",
        copyToCacheDirectory: false,
      });

      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const name = asset.name ?? "unknown.md";

      if (!name.endsWith(".md") && !name.endsWith(".txt")) {
        Alert.alert("Invalid file", "Please select a .md or .txt file.");
        return;
      }

      await importKnowledgeFile(asset.uri, name);
      await refreshKnowledgeFiles();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof KnowledgeTooLargeError) {
        Alert.alert("File too large", msg);
      } else {
        Alert.alert("Error", `Failed to import file: ${msg}`);
      }
    }
  };

  const handleRemoveKnowledgeFile = (file: KnowledgeFile) => {
    Alert.alert(
      "Remove file",
      `Remove "${file.filename}" from Vesta's context?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await removeKnowledgeFile(file.id);
            await refreshKnowledgeFiles();
          },
        },
      ],
    );
  };

  const toggleLanguage = () => {
    const next: Language = language === "it" ? "en" : "it";
    setLanguage(next);
  };

  const shortPath = modelPath
    ? modelPath.split("/").pop() || modelPath
    : "None";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Model section */}
      <Text style={styles.sectionTitle}>Model</Text>
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Status</Text>
          <View style={[styles.statusBadge, modelLoaded ? styles.statusLoaded : styles.statusNotLoaded]}>
            <View style={[styles.statusDot, modelLoaded ? styles.dotLoaded : styles.dotNotLoaded]} />
            <Text style={[styles.statusText, modelLoaded ? styles.statusLoadedText : styles.statusNotLoadedText]}>
              {modelLoaded ? "Loaded" : "Not loaded"}
            </Text>
          </View>
        </View>

        {modelLoaded && (
          <View style={styles.fileRow}>
            <Text style={styles.label}>File</Text>
            <Text style={styles.fileValue} numberOfLines={1}>
              {shortPath}
            </Text>
          </View>
        )}

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => router.push("/models")}
            activeOpacity={0.7}
          >
            <Text style={styles.btnPrimaryText}>
              {modelLoaded ? "Manage Models" : "Get a Model"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Language section */}
      <Text style={styles.sectionTitle}>Language</Text>
      <View style={styles.card}>
        <TouchableOpacity style={styles.langBtn} onPress={toggleLanguage} activeOpacity={0.7}>
          <View>
            <Text style={styles.langText}>
              {language === "it" ? "Italiano" : "English"}
            </Text>
            <Text style={styles.langHint}>Tap to switch</Text>
          </View>
          <View style={styles.langArrow}>
            <Text style={styles.langArrowText}>⇄</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Privacy & Safety section */}
      <Text style={styles.sectionTitle}>Privacy & Safety</Text>
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleTitle}>Confirm actions</Text>
            <Text style={styles.toggleHint}>
              Ask before Vesta sets alarms, creates events, or reminders.
            </Text>
          </View>
          <Switch
            value={confirmActions}
            onValueChange={toggleConfirmActions}
            trackColor={{ false: colors.disabled, true: colors.accent }}
          />
        </View>
      </View>

      {/* Knowledge Files section */}
      <Text style={styles.sectionTitle}>Knowledge Files</Text>
      <View style={styles.card}>
        <Text style={styles.knowledgeDesc}>
          Upload .md files with personal context — preferences, routines, notes. Vesta uses them to know you better, fully offline.
        </Text>

        {knowledgeFiles.map((file) => (
          <View key={file.id} style={styles.knowledgeFileRow}>
            <View style={styles.knowledgeFileInfo}>
              <Text style={styles.knowledgeFileName} numberOfLines={1}>
                {file.filename}
              </Text>
              <Text style={styles.knowledgeFileSize}>
                {formatFileSize(file.fileSize)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => handleRemoveKnowledgeFile(file)}
              style={styles.knowledgeRemoveBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.knowledgeRemoveText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, styles.knowledgeAddBtn]}
          onPress={handleAddKnowledgeFile}
          activeOpacity={0.7}
        >
          <Text style={styles.btnPrimaryText}>Add File</Text>
        </TouchableOpacity>
      </View>

      {/* About section */}
      <Text style={styles.sectionTitle}>About</Text>
      <View style={styles.card}>
        <Text style={styles.aboutText}>
          Vesta is an offline-first AI assistant that runs entirely on your device. No cloud, no data leaves your phone.
        </Text>
        <Text style={styles.versionText}>v0.1.0 — Fase 2 (Core Polish)</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  sectionTitle: {
    color: colors.textMuted,
    ...typography.sectionTitle,
    marginBottom: 10,
    marginTop: 20,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  // Status
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.full,
  },
  statusLoaded: {
    backgroundColor: colors.successBg,
  },
  statusNotLoaded: {
    backgroundColor: colors.accentMuted,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  dotLoaded: {
    backgroundColor: colors.success,
  },
  dotNotLoaded: {
    backgroundColor: colors.accent,
  },
  statusText: {
    fontSize: 13,
    fontWeight: "600",
  },
  statusLoadedText: {
    color: colors.success,
  },
  statusNotLoadedText: {
    color: colors.accent,
  },
  // Toggle
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleInfo: {
    flex: 1,
    marginRight: 12,
  },
  toggleTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "600",
  },
  toggleHint: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 3,
    lineHeight: 18,
  },
  // File
  fileRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  fileValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "500",
    maxWidth: "60%",
  },
  // Progress
  progressContainer: {
    marginBottom: spacing.md,
  },
  progressTrack: {
    height: 4,
    backgroundColor: colors.borderLight,
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.accent,
    borderRadius: 2,
  },
  progressText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  // Buttons
  btnRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  btn: {
    borderRadius: radii.sm,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  btnPrimaryText: {
    color: "#fff",
    ...typography.button,
  },
  btnOutline: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.error,
  },
  btnOutlineText: {
    color: colors.error,
    ...typography.button,
  },
  // Language
  langBtn: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  langText: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "600",
  },
  langHint: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  langArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  langArrowText: {
    fontSize: 16,
    color: colors.accent,
  },
  // Knowledge files
  knowledgeDesc: {
    color: colors.textSecondary,
    ...typography.bodySmall,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  knowledgeFileRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  knowledgeFileInfo: {
    flex: 1,
    marginRight: 12,
  },
  knowledgeFileName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "500",
  },
  knowledgeFileSize: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  knowledgeRemoveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.error,
  },
  knowledgeRemoveText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: "500",
  },
  knowledgeAddBtn: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
  },
  // About
  aboutText: {
    color: colors.textSecondary,
    ...typography.body,
    marginBottom: 8,
  },
  versionText: {
    color: colors.textMuted,
    ...typography.caption,
  },
});
