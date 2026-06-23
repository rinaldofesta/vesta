import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useModelStore } from "../lib/store/model-store";
import { CATALOG } from "../lib/models/catalog";
import { listGgufFiles, type HfFile } from "../lib/models/hf-client";
import type { CatalogModel, InstalledModel } from "../lib/models/types";
import { formatBytes, formatDuration, percent, fitLabel, type FitLabel } from "../lib/models/format";
import { colors, spacing, radii, typography } from "../lib/theme";

export default function ModelsScreen() {
  const installed = useModelStore((s) => s.installed);
  const progress = useModelStore((s) => s.progress);
  const freeBytes = useModelStore((s) => s.freeBytes);
  const caps = useModelStore((s) => s.caps);
  const error = useModelStore((s) => s.error);
  const busy = useModelStore((s) => s.busy);
  const refresh = useModelStore((s) => s.refresh);
  const downloadFromCatalog = useModelStore((s) => s.downloadFromCatalog);
  const downloadFromRepo = useModelStore((s) => s.downloadFromRepo);
  const activate = useModelStore((s) => s.activate);
  const remove = useModelStore((s) => s.remove);
  const cancel = useModelStore((s) => s.cancel);
  const importLocalModel = useModelStore((s) => s.importLocalModel);
  const clearError = useModelStore((s) => s.clearError);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const installedByRepo = useCallback(
    (repo: string): InstalledModel | undefined =>
      installed.find((m) => m.hfRepo === repo),
    [installed],
  );

  const confirmRemove = (m: InstalledModel) => {
    Alert.alert("Delete model", `Remove "${m.displayName}" and free ${formatBytes(m.sizeBytes)}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove(m.id) },
    ]);
  };

  const handleImport = async () => {
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
    await importLocalModel(asset.uri, name);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.notice}>
        Browsing or downloading a model is the only time Vesta uses the network, and only when you tap. Everything else stays on your device.
      </Text>
      <View style={styles.deviceRow}>
        <Text style={styles.deviceText}>
          {caps?.deviceName ?? "Your device"}
          {caps?.totalRamMb ? ` · ${(caps.totalRamMb / 1024).toFixed(0)} GB RAM` : ""}
          {freeBytes != null ? ` · ${formatBytes(freeBytes)} free` : ""}
        </Text>
      </View>

      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError} activeOpacity={0.8}>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorDismiss}>Tap to dismiss</Text>
        </TouchableOpacity>
      )}

      {/* Recommended catalog */}
      <Text style={styles.sectionTitle}>Recommended</Text>
      {CATALOG.map((m) => (
        <CatalogRow
          key={m.id}
          model={m}
          installed={installedByRepo(m.hfRepo)}
          progress={progress}
          fit={fitLabel(m.minRamMb, caps?.totalRamMb ?? null, m.sizeBytesApprox, freeBytes)}
          onDownload={() => downloadFromCatalog(m)}
          onActivate={activate}
          onCancel={cancel}
          onRemove={confirmRemove}
        />
      ))}

      {/* Installed (non-catalog, e.g. imported or ad-hoc HF) */}
      {installed.filter((m) => !CATALOG.some((c) => c.hfRepo === m.hfRepo)).length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Installed</Text>
          {installed
            .filter((m) => !CATALOG.some((c) => c.hfRepo === m.hfRepo))
            .map((m) => (
              <InstalledRow
                key={m.id}
                model={m}
                progress={progress[m.id]}
                onActivate={activate}
                onCancel={cancel}
                onRemove={confirmRemove}
              />
            ))}
        </>
      )}

      {/* Add from HuggingFace */}
      <Text style={styles.sectionTitle}>Add from HuggingFace</Text>
      <AddFromHuggingFace onDownload={downloadFromRepo} />

      {/* Import local file */}
      <Text style={styles.sectionTitle}>Import local file</Text>
      <View style={styles.card}>
        <Text style={styles.rowDesc}>
          Already have a .gguf file on your device? Import it directly.
        </Text>
        <TouchableOpacity
          style={[styles.btn, styles.btnOutline, { marginTop: spacing.md, alignSelf: "flex-start" }]}
          onPress={handleImport}
          disabled={busy}
          activeOpacity={0.7}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={styles.btnOutlineText}>Choose .gguf file</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function fitStyle(level: FitLabel["level"]) {
  switch (level) {
    case "ok":
      return styles.fitOk;
    case "tight":
      return styles.fitTight;
    case "insufficient":
      return styles.fitBad;
    default:
      return styles.fitUnknown;
  }
}

function ProgressBar({ written, total, etaSeconds }: { written: number; total: number; etaSeconds: number | null }) {
  const pct = percent(written, total);
  return (
    <View style={styles.progressContainer}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.progressText}>
        {formatBytes(written)} / {formatBytes(total)} · {Math.round(pct)}%
        {etaSeconds != null && etaSeconds > 0 ? ` · ${formatDuration(etaSeconds)} left` : ""}
      </Text>
    </View>
  );
}

function CatalogRow({
  model,
  installed,
  progress,
  fit,
  onDownload,
  onActivate,
  onCancel,
  onRemove,
}: {
  model: CatalogModel;
  installed: InstalledModel | undefined;
  progress: Record<string, { bytesWritten: number; bytesTotal: number; etaSeconds: number | null; status: string }>;
  fit: FitLabel;
  onDownload: () => void;
  onActivate: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (m: InstalledModel) => void;
}) {
  const prog = installed ? progress[installed.id] : undefined;
  const downloading = prog?.status === "downloading";

  return (
    <View style={[styles.card, installed?.isActive && styles.cardActive]}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>{model.displayName}</Text>
        <Text style={styles.rowMeta}>
          {model.quant} · {formatBytes(model.sizeBytesApprox)}
        </Text>
      </View>
      <Text style={styles.rowDesc}>{model.description}</Text>
      <View style={styles.fitRow}>
        {fit.text !== "" && (
          <Text style={[styles.fitBadge, fitStyle(fit.level)]}>{fit.text}</Text>
        )}
        <Text style={styles.rowHint}>
          ~{Math.round(model.minRamMb / 1024)} GB RAM · {model.license}
        </Text>
      </View>

      {downloading && prog && (
        <ProgressBar written={prog.bytesWritten} total={prog.bytesTotal} etaSeconds={prog.etaSeconds} />
      )}

      <View style={styles.btnRow}>
        {!installed && (
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onDownload} activeOpacity={0.7}>
            <Text style={styles.btnPrimaryText}>Download</Text>
          </TouchableOpacity>
        )}
        {downloading && installed && (
          <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => onCancel(installed.id)} activeOpacity={0.7}>
            <Text style={styles.btnOutlineText}>Cancel</Text>
          </TouchableOpacity>
        )}
        {installed && installed.state === "ready" && !installed.isActive && (
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => onActivate(installed.id)} activeOpacity={0.7}>
            <Text style={styles.btnPrimaryText}>Use this model</Text>
          </TouchableOpacity>
        )}
        {installed?.isActive && (
          <View style={[styles.btn, styles.btnActive]}>
            <Text style={styles.btnActiveText}>● Active</Text>
          </View>
        )}
        {installed && !downloading && (
          <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => onRemove(installed)} activeOpacity={0.7}>
            <Text style={styles.btnGhostText}>Delete</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function InstalledRow({
  model,
  progress,
  onActivate,
  onCancel,
  onRemove,
}: {
  model: InstalledModel;
  progress?: { bytesWritten: number; bytesTotal: number; etaSeconds: number | null; status: string };
  onActivate: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (m: InstalledModel) => void;
}) {
  const downloading = progress?.status === "downloading";
  return (
    <View style={[styles.card, model.isActive && styles.cardActive]}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle} numberOfLines={1}>{model.displayName}</Text>
        <Text style={styles.rowMeta}>{formatBytes(model.sizeBytes)}</Text>
      </View>
      {model.hfRepo && <Text style={styles.rowHint}>{model.hfRepo}</Text>}
      {model.state === "error" && <Text style={styles.rowError}>Failed — re-download or delete.</Text>}

      {downloading && progress && (
        <ProgressBar written={progress.bytesWritten} total={progress.bytesTotal} etaSeconds={progress.etaSeconds} />
      )}

      <View style={styles.btnRow}>
        {downloading && (
          <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => onCancel(model.id)} activeOpacity={0.7}>
            <Text style={styles.btnOutlineText}>Cancel</Text>
          </TouchableOpacity>
        )}
        {model.state === "ready" && !model.isActive && (
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => onActivate(model.id)} activeOpacity={0.7}>
            <Text style={styles.btnPrimaryText}>Use this model</Text>
          </TouchableOpacity>
        )}
        {model.isActive && (
          <View style={[styles.btn, styles.btnActive]}>
            <Text style={styles.btnActiveText}>● Active</Text>
          </View>
        )}
        {!downloading && (
          <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => onRemove(model)} activeOpacity={0.7}>
            <Text style={styles.btnGhostText}>Delete</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function AddFromHuggingFace({
  onDownload,
}: {
  onDownload: (repo: string, file: HfFile, displayName: string) => void;
}) {
  const [repo, setRepo] = useState("");
  const [files, setFiles] = useState<HfFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const browse = async () => {
    const trimmed = repo.trim();
    if (!trimmed.includes("/")) {
      setErr("Enter a repo id like 'Qwen/Qwen3-4B-GGUF'.");
      return;
    }
    setLoading(true);
    setErr(null);
    setFiles(null);
    try {
      const found = await listGgufFiles(trimmed);
      if (found.length === 0) setErr("No .gguf files in this repo.");
      setFiles(found);
    } catch (e) {
      const ex = e as Error & { code?: string };
      setErr(ex.code === "GATED" ? "This repo is gated (login required) — not supported yet." : ex.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.rowDesc}>
        Paste any public HuggingFace GGUF repo to list its files and download the quant you want.
      </Text>
      <View style={styles.hfInputRow}>
        <TextInput
          style={styles.hfInput}
          value={repo}
          onChangeText={setRepo}
          placeholder="org/repo-GGUF"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={browse} disabled={loading} activeOpacity={0.7}>
          {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnPrimaryText}>Browse</Text>}
        </TouchableOpacity>
      </View>
      {err && <Text style={styles.rowError}>{err}</Text>}
      {files?.map((f) => (
        <View key={f.path} style={styles.fileRow}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={styles.fileName} numberOfLines={1}>{f.path.split("/").pop()}</Text>
            <Text style={styles.fileSize}>{formatBytes(f.sizeBytes)}</Text>
          </View>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => onDownload(repo.trim(), f, repo.trim().split("/").pop() ?? "Model")}
            activeOpacity={0.7}
          >
            <Text style={styles.btnPrimaryText}>Download</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 48 },
  notice: { color: colors.textMuted, ...typography.caption, lineHeight: 18, marginBottom: 6 },
  deviceRow: { marginBottom: 8 },
  deviceText: { color: colors.textSecondary, fontSize: 13, fontWeight: "500" },
  fitRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 8 },
  fitBadge: {
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.full,
    overflow: "hidden",
  },
  fitOk: { color: colors.success, backgroundColor: colors.successBg },
  fitTight: { color: colors.accent, backgroundColor: colors.accentMuted },
  fitBad: { color: colors.error, backgroundColor: colors.accentMuted },
  fitUnknown: { color: colors.textMuted },
  sectionTitle: { color: colors.textMuted, ...typography.sectionTitle, marginBottom: 10, marginTop: 20, marginLeft: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 12,
  },
  cardActive: { borderColor: colors.success, borderWidth: 1 },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "600", flex: 1, marginRight: 8 },
  rowMeta: { color: colors.textMuted, fontSize: 12 },
  rowDesc: { color: colors.textSecondary, ...typography.bodySmall, lineHeight: 19, marginTop: 6 },
  rowHint: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
  rowError: { color: colors.error, fontSize: 13, marginTop: 8 },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 14, flexWrap: "wrap" },
  btn: { borderRadius: radii.sm, paddingHorizontal: 16, paddingVertical: 10, justifyContent: "center" },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: { color: "#fff", ...typography.button },
  btnOutline: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.accent },
  btnOutlineText: { color: colors.accent, ...typography.button },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.error },
  btnGhostText: { color: colors.error, ...typography.button },
  btnActive: { backgroundColor: colors.successBg },
  btnActiveText: { color: colors.success, ...typography.button },
  progressContainer: { marginTop: 14 },
  progressTrack: { height: 4, backgroundColor: colors.borderLight, borderRadius: 2, overflow: "hidden", marginBottom: 8 },
  progressFill: { height: "100%", backgroundColor: colors.accent, borderRadius: 2 },
  progressText: { color: colors.textMuted, fontSize: 12 },
  hfInputRow: { flexDirection: "row", gap: 10, marginTop: spacing.md, alignItems: "center" },
  hfInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 14,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
    marginTop: 10,
  },
  fileName: { color: colors.textPrimary, fontSize: 13, fontWeight: "500" },
  fileSize: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  errorBanner: {
    backgroundColor: colors.accentMuted,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginBottom: 12,
  },
  errorText: { color: colors.error, fontSize: 13, fontWeight: "500" },
  errorDismiss: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
});
