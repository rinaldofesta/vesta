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
import { useModelStore } from "../lib/store/model-store";
import {
  getPerfSettings,
  setPerfSettings,
  DEFAULT_PERF,
  type PerfSettings,
} from "../lib/llm/perf-config";
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

  const reloadActive = useModelStore((s) => s.reloadActive);
  const [perf, setPerf] = useState<PerfSettings>(DEFAULT_PERF);
  const [perfBusy, setPerfBusy] = useState(false);

  useEffect(() => {
    getPerfSettings().then(setPerf).catch(() => {});
  }, []);

  // Persist a perf change, then reload the model so it takes effect.
  const updatePerf = async (next: PerfSettings) => {
    const prev = perf;
    setPerf(next);
    setPerfBusy(true);
    try {
      await setPerfSettings(next);
      await reloadActive();
    } catch (e) {
      // Full revert on failure (e.g. a KV-quant combo the model rejects):
      // un-persist the bad setting too — leaving it in config would make the
      // next app launch auto-load fail and boot with no model — and reload
      // with the previous settings so a model is loaded again right now.
      setPerf(prev);
      await setPerfSettings(prev).catch(() => {});
      await reloadActive().catch(() => {});
      Alert.alert("Performance", e instanceof Error ? e.message : String(e));
    } finally {
      setPerfBusy(false);
    }
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

      {/* Documents section */}
      <Text style={styles.sectionTitle}>Documents</Text>
      <View style={styles.card}>
        <Text style={styles.knowledgeDesc}>
          Import PDFs, Word, or text files and ask Vesta about their contents —
          indexed and searched on-device (RAG), fully offline.
        </Text>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, styles.knowledgeAddBtn]}
          onPress={() => router.push("/documents")}
          activeOpacity={0.7}
        >
          <Text style={styles.btnPrimaryText}>Manage Documents</Text>
        </TouchableOpacity>
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

      {/* Performance section */}
      <Text style={styles.sectionTitle}>Performance</Text>
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleTitle}>CPU threads</Text>
            <Text style={styles.toggleHint}>
              More threads can speed up generation on multi-core phones.
            </Text>
          </View>
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={styles.stepperBtn}
              disabled={perfBusy || perf.threads <= 1}
              onPress={() =>
                updatePerf({ ...perf, threads: Math.max(1, perf.threads - 1) })
              }
              activeOpacity={0.7}
            >
              <Text style={styles.stepperText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.stepperValue}>{perf.threads}</Text>
            <TouchableOpacity
              style={styles.stepperBtn}
              disabled={perfBusy || perf.threads >= 8}
              onPress={() =>
                updatePerf({ ...perf, threads: Math.min(8, perf.threads + 1) })
              }
              activeOpacity={0.7}
            >
              <Text style={styles.stepperText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleTitle}>Quantize KV cache (q8_0)</Text>
            <Text style={styles.toggleHint}>
              Halves context memory so longer chats fit. Slower on CPU (~1.5x
              measured) — use only if you need the RAM.
            </Text>
          </View>
          <Switch
            value={perf.kvQuant}
            onValueChange={(v) => updatePerf({ ...perf, kvQuant: v })}
            disabled={perfBusy}
            trackColor={{ false: colors.disabled, true: colors.accent }}
          />
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleTitle}>Keep model in RAM (mlock)</Text>
            <Text style={styles.toggleHint}>
              Pins weights so Android cannot page them out. Faster, more RAM.
            </Text>
          </View>
          <Switch
            value={perf.useMlock}
            onValueChange={(v) => updatePerf({ ...perf, useMlock: v })}
            disabled={perfBusy}
            trackColor={{ false: colors.disabled, true: colors.accent }}
          />
        </View>

        {perfBusy && (
          <Text style={styles.toggleHint}>Reloading model to apply…</Text>
        )}
      </View>

      {/* Diagnostics section */}
      <Text style={styles.sectionTitle}>Diagnostics</Text>
      <View style={styles.card}>
        <Text style={styles.knowledgeDesc}>
          On-device status: model, last-turn prefill, database and prefix-cache
          size. Everything stays local.
        </Text>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, styles.knowledgeAddBtn]}
          onPress={() => router.push("/diagnostics")}
          activeOpacity={0.8}
        >
          <Text style={styles.btnPrimaryText}>Open Diagnostics</Text>
        </TouchableOpacity>
      </View>

      {/* MCP Server section */}
      <Text style={styles.sectionTitle}>MCP Server</Text>
      <View style={styles.card}>
        <Text style={styles.knowledgeDesc}>
          Let a laptop agent (Claude Code / Desktop) call Vesta&apos;s read tools
          over your Wi-Fi. Your data stays on the phone.
        </Text>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, styles.knowledgeAddBtn]}
          onPress={() => router.push("/mcp")}
          activeOpacity={0.8}
        >
          <Text style={styles.btnPrimaryText}>Configure MCP</Text>
        </TouchableOpacity>
      </View>

      {/* About section */}
      <Text style={styles.sectionTitle}>About</Text>
      <View style={styles.card}>
        <Text style={styles.aboutText}>
          Vesta is an offline-first AI assistant that runs entirely on your device. No cloud, no data leaves your phone.
        </Text>
        <Text style={styles.versionText}>v0.1.0 — Fase 5 (Reliability &amp; Release)</Text>
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
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  stepperBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperText: {
    fontSize: 20,
    color: colors.accent,
    fontWeight: "600",
  },
  stepperValue: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
    minWidth: 16,
    textAlign: "center",
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
