// On-device diagnostics — the offline-first substitute for telemetry. Shows the
// model, the last turn's prefill cost (the JS-visible proxy for KV-cache reuse:
// a warm append evaluates few prompt tokens, a cold turn many), and the on-disk
// footprint (database + prefix session cache). Everything is read locally; the
// screen sends nothing anywhere.

import { useCallback, useEffect, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import {
  getModelInfo,
  getContextSize,
  getKvCacheType,
  getLastCompletion,
  type LastCompletionStats,
} from "../lib/llm/llm-engine";
import {
  getSessionCacheInfo,
  type SessionCacheInfo,
} from "../lib/llm/session-cache";
import { getDatabaseSizeBytes } from "../lib/storage/database";
import { getActiveModel } from "../lib/models/model-registry";
import { formatBytes } from "../lib/models/format";
import { colors, spacing, typography, radii } from "../lib/theme";

interface Diag {
  modelLoaded: boolean;
  modelName: string | null;
  modelPath: string | null;
  contextSize: number;
  kvType: string;
  last: LastCompletionStats | null;
  dbBytes: number;
  cache: SessionCacheInfo;
}

async function gather(): Promise<Diag> {
  const [active, cache, dbBytes] = await Promise.all([
    getActiveModel(),
    getSessionCacheInfo(),
    getDatabaseSizeBytes(),
  ]);
  const info = getModelInfo();
  return {
    modelLoaded: info.loaded,
    modelName: active?.displayName ?? null,
    modelPath: info.path ?? null,
    contextSize: getContextSize(),
    kvType: getKvCacheType(),
    last: getLastCompletion(),
    dbBytes,
    cache,
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function DiagnosticsScreen() {
  const [diag, setDiag] = useState<Diag | null>(null);

  const refresh = useCallback(() => {
    gather()
      .then(setDiag)
      .catch(() => setDiag(null));
  }, []);

  useEffect(refresh, [refresh]);

  const fileName = diag?.modelPath?.split("/").pop() ?? "—";
  const last = diag?.last;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Model</Text>
      <View style={styles.card}>
        <Row label="Status" value={diag?.modelLoaded ? "Loaded" : "Not loaded"} />
        <Row label="Name" value={diag?.modelName ?? "—"} />
        <Row label="File" value={fileName} />
        <Row label="Context" value={diag ? `${diag.contextSize} tokens` : "—"} />
        <Row label="KV cache" value={diag?.kvType ?? "—"} />
      </View>

      <Text style={styles.sectionTitle}>Last turn</Text>
      <View style={styles.card}>
        {last ? (
          <>
            <Row label="Prefill" value={`${Math.round(last.promptMs)} ms`} />
            <Row label="Prompt tokens" value={`${last.promptTokens}`} />
            <Row label="Generated" value={`${last.predictedTokens} tokens`} />
            <Row
              label="Decode speed"
              value={`${last.predictedPerSecond.toFixed(1)} tok/s`}
            />
            <Text style={styles.hint}>
              Fewer prompt tokens means the KV cache was reused (a warm append).
              A large count is a cold re-prefill.
            </Text>
          </>
        ) : (
          <Text style={styles.hint}>No completion yet this session.</Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>Storage</Text>
      <View style={styles.card}>
        <Row label="Database" value={diag ? formatBytes(diag.dbBytes) : "—"} />
        <Row
          label="Prefix cache"
          value={
            diag
              ? diag.cache.exists
                ? formatBytes(diag.cache.sizeBytes)
                : "none"
              : "—"
          }
        />
        <Row
          label="Cache tokens"
          value={diag?.cache.tokenCount != null ? `${diag.cache.tokenCount}` : "—"}
        />
        <Row
          label="Cache primed"
          value={diag ? (diag.cache.primed ? "Yes" : "No") : "—"}
        />
        <Text style={styles.hint}>
          The prefix cache stores the stable prompt&apos;s KV state so the first
          message after a cold start is fast. It is large by nature (full KV
          state).
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.btn, styles.btnPrimary]}
        onPress={refresh}
        activeOpacity={0.8}
      >
        <Text style={styles.btnPrimaryText}>Refresh</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  sectionTitle: {
    ...typography.sectionTitle,
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.xs,
    gap: spacing.md,
  },
  label: { ...typography.body, color: colors.textSecondary },
  value: { ...typography.body, color: colors.textPrimary, flexShrink: 1, textAlign: "right" },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  btn: {
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.xl,
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: { ...typography.button, color: colors.userText },
});
