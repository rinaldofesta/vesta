import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import {
  importAndIndexDocument,
  listDocuments,
  removeDocument,
  EmptyDocumentError,
  type IndexProgress,
} from "../lib/documents/document-manager";
import {
  classifyDocument,
  UnsupportedDocumentError,
} from "../lib/documents/parsers";
import { EmbeddingModelMissingError } from "../lib/llm/embed-engine";
import type { DocumentRecord } from "../lib/storage/database";
import { colors, spacing } from "../lib/theme";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsScreen() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<IndexProgress | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDocuments(await listDocuments());
    } catch (err) {
      console.warn("Failed to load documents:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const name = asset.name ?? "document";

      if (!classifyDocument(name, asset.mimeType)) {
        Alert.alert(
          "Unsupported file",
          "Please choose a PDF, Word (.docx), text, or Markdown file.",
        );
        return;
      }

      setBusy(true);
      setProgress({ phase: "parsing", done: 0, total: 1 });
      await importAndIndexDocument(
        asset.uri,
        name,
        asset.mimeType ?? null,
        asset.size ?? 0,
        setProgress,
      );
      await refresh();
    } catch (err) {
      if (err instanceof EmbeddingModelMissingError) {
        Alert.alert(
          "Embedding model needed",
          "Download the Nomic Embed model from the Models screen to index and search documents.",
        );
      } else if (err instanceof UnsupportedDocumentError) {
        Alert.alert("Unsupported file", err.message);
      } else if (err instanceof EmptyDocumentError) {
        Alert.alert("Nothing to index", err.message);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        Alert.alert("Import failed", msg);
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleRemove = (doc: DocumentRecord) => {
    Alert.alert("Remove document", `Remove "${doc.filename}" and its index?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await removeDocument(doc.id);
          await refresh();
        },
      },
    ]);
  };

  const progressLabel = !progress
    ? ""
    : progress.phase === "embedding"
      ? `Indexing ${progress.done}/${progress.total} chunks…`
      : progress.phase === "parsing"
        ? "Reading document…"
        : "Saving…";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.desc}>
        Import PDF, Word (.docx), text, or Markdown files. Vesta indexes them
        on-device so you can ask questions about their contents — fully offline.
        Requires an embedding model (Nomic Embed), available in Models.
      </Text>

      {documents.map((doc) => (
        <View key={doc.id} style={styles.row}>
          <View style={styles.rowInfo}>
            <Text style={styles.rowName} numberOfLines={1}>
              {doc.filename}
            </Text>
            <Text style={styles.rowMeta}>
              {doc.chunkCount} chunk{doc.chunkCount === 1 ? "" : "s"} ·{" "}
              {formatFileSize(doc.sizeBytes)}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => handleRemove(doc)}
            style={styles.removeBtn}
            activeOpacity={0.7}
            disabled={busy}
          >
            <Text style={styles.removeText}>Remove</Text>
          </TouchableOpacity>
        </View>
      ))}

      {documents.length === 0 && !busy && (
        <Text style={styles.empty}>No documents imported yet.</Text>
      )}

      {busy ? (
        <View style={styles.progressBox}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.progressText}>{progressLabel}</Text>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.importBtn}
          onPress={handleImport}
          activeOpacity={0.7}
        >
          <Text style={styles.importBtnText}>+ Import Document</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  desc: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowInfo: { flex: 1, marginRight: spacing.sm },
  rowName: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  rowMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  removeBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.errorBg,
  },
  removeText: { color: colors.error, fontSize: 13, fontWeight: "600" },
  empty: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    marginVertical: spacing.xl,
  },
  progressBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  progressText: { fontSize: 14, color: colors.textSecondary },
  importBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  importBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
});
