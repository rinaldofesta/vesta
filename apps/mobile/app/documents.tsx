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
import { useRouter } from "expo-router";
import { useChatStore } from "../lib/store/chat-store";
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
  DocumentParseError,
} from "../lib/documents/parsers";
import { EmbeddingModelMissingError } from "../lib/llm/embed-engine";
import type { DocumentRecord } from "../lib/storage/database";
import type { Language } from "../lib/orchestrator/types";
import { colors, spacing } from "../lib/theme";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Bilingual UI strings (CLAUDE.md: user-facing text must work in IT and EN).
function strings(lang: Language) {
  const it = lang === "it";
  return {
    desc: it
      ? "Importa file PDF, Word (.docx), di testo o Markdown. Vesta li indicizza sul dispositivo così puoi farci domande — completamente offline. Serve un modello di embedding (Nomic Embed), disponibile in Modelli."
      : "Import PDF, Word (.docx), text, or Markdown files. Vesta indexes them on-device so you can ask questions about their contents — fully offline. Requires an embedding model (Nomic Embed), available in Models.",
    empty: it ? "Nessun documento importato." : "No documents imported yet.",
    importBtn: it ? "+ Importa documento" : "+ Import Document",
    remove: it ? "Rimuovi" : "Remove",
    chunks: (n: number) =>
      it
        ? `${n} frammento${n === 1 ? "" : "i"}`
        : `${n} chunk${n === 1 ? "" : "s"}`,
    reading: it ? "Lettura del documento…" : "Reading document…",
    indexing: (d: number, t: number) =>
      it ? `Indicizzazione ${d}/${t} frammenti…` : `Indexing ${d}/${t} chunks…`,
    saving: it ? "Salvataggio…" : "Saving…",
    busyTitle: it ? "Attendi" : "Please wait",
    busyBody: it
      ? "Aspetta che Vesta finisca la risposta corrente."
      : "Wait for Vesta to finish the current response.",
    unsupportedTitle: it ? "File non supportato" : "Unsupported file",
    unsupportedBody: it
      ? "Scegli un file PDF, Word (.docx), di testo o Markdown."
      : "Please choose a PDF, Word (.docx), text, or Markdown file.",
    embedTitle: it ? "Serve un modello" : "Embedding model needed",
    embedBody: it
      ? "Scarica il modello Nomic Embed dalla schermata Modelli per indicizzare e cercare nei documenti."
      : "Download the Nomic Embed model from the Models screen to index and search documents.",
    getModel: it ? "Vai a Modelli" : "Go to Models",
    cancel: it ? "Annulla" : "Cancel",
    emptyDocTitle: it ? "Niente da indicizzare" : "Nothing to index",
    parseTitle: it ? "Impossibile leggere il file" : "Couldn't read the file",
    parseBody: it
      ? "Questo file potrebbe essere danneggiato, protetto da password o in un formato non supportato."
      : "This file may be corrupted, password-protected, or in an unsupported format.",
    importFailTitle: it ? "Importazione non riuscita" : "Import failed",
    removeTitle: it ? "Rimuovi documento" : "Remove document",
    removeBody: (name: string) =>
      it
        ? `Rimuovere "${name}" e il suo indice?`
        : `Remove "${name}" and its index?`,
  };
}

export default function DocumentsScreen() {
  const router = useRouter();
  const language = useChatStore((s) => s.language);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const t = strings(language);

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
    // Don't compete with an in-flight chat generation for CPU.
    if (useChatStore.getState().isGenerating) {
      Alert.alert(t.busyTitle, t.busyBody);
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const name = asset.name ?? "document";

      if (!classifyDocument(name, asset.mimeType)) {
        Alert.alert(t.unsupportedTitle, t.unsupportedBody);
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
        Alert.alert(t.embedTitle, t.embedBody, [
          { text: t.cancel, style: "cancel" },
          { text: t.getModel, onPress: () => router.push("/models") },
        ]);
      } else if (err instanceof UnsupportedDocumentError) {
        Alert.alert(t.unsupportedTitle, t.unsupportedBody);
      } else if (err instanceof EmptyDocumentError) {
        Alert.alert(t.emptyDocTitle, t.parseBody);
      } else if (err instanceof DocumentParseError) {
        Alert.alert(t.parseTitle, t.parseBody);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        Alert.alert(t.importFailTitle, msg);
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleRemove = (doc: DocumentRecord) => {
    Alert.alert(t.removeTitle, t.removeBody(doc.filename), [
      { text: t.cancel, style: "cancel" },
      {
        text: t.remove,
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
      ? t.indexing(progress.done, progress.total)
      : progress.phase === "parsing"
        ? t.reading
        : t.saving;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.desc}>{t.desc}</Text>

      {documents.map((doc) => (
        <View key={doc.id} style={styles.row}>
          <View style={styles.rowInfo}>
            <Text style={styles.rowName} numberOfLines={1}>
              {doc.filename}
            </Text>
            <Text style={styles.rowMeta}>
              {t.chunks(doc.chunkCount)} · {formatFileSize(doc.sizeBytes)}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => handleRemove(doc)}
            style={styles.removeBtn}
            activeOpacity={0.7}
            disabled={busy}
          >
            <Text style={styles.removeText}>{t.remove}</Text>
          </TouchableOpacity>
        </View>
      ))}

      {documents.length === 0 && !busy && (
        <Text style={styles.empty}>{t.empty}</Text>
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
          <Text style={styles.importBtnText}>{t.importBtn}</Text>
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
