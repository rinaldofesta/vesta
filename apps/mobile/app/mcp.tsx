import { useCallback, useEffect, useState } from "react";
import {
  ScrollView, View, Text, TextInput, TouchableOpacity, Switch, Alert, StyleSheet,
} from "react-native";
import {
  enableMcpServer, disableMcpServer, isMcpEnabled, MCP_PORT,
} from "../lib/mcp/mcp-lifecycle";
import {
  createClient, listClients, revokeClient, type McpClient,
} from "../lib/mcp/pairing-store";
import { colors, spacing, typography, radii } from "../lib/theme";

export default function McpScreen() {
  const [enabled, setEnabled] = useState(false);
  const [ip, setIp] = useState<string | null>(null);
  const [clients, setClients] = useState<McpClient[]>([]);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");

  const refresh = useCallback(() => {
    (async () => {
      try {
        const on = await isMcpEnabled();
        setEnabled(on);
        if (on) {
          // Enabled in a previous session/visit: ensure the server is running
          // this session (enableMcpServer is idempotent) and capture the LAN IP
          // so the pairing command shows a real address, not the placeholder.
          const res = await enableMcpServer();
          setIp(res.ip);
        }
      } catch {
        // Leave the toggle in its last-known state; toggle() surfaces errors.
      }
    })();
    listClients().then(setClients).catch(() => setClients([]));
  }, []);
  useEffect(refresh, [refresh]);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        const res = await enableMcpServer();
        setIp(res.ip);
      } else {
        await disableMcpServer();
        setIp(null);
      }
      setEnabled(on);
    } catch (e) {
      Alert.alert("MCP", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addClient = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const c = await createClient(name);
      setNewName("");
      setClients(await listClients());
      const url = ip ? `http://${ip}:${MCP_PORT}/mcp` : `http://<phone-ip>:${MCP_PORT}/mcp`;
      Alert.alert(
        c.name,
        `Add to your MCP client:\n\nclaude mcp add --transport http vesta ${url} --header "Authorization: Bearer ${c.token}"`,
      );
    } catch (e) {
      Alert.alert("MCP", e instanceof Error ? e.message : String(e));
    }
  };

  const revoke = (c: McpClient) =>
    Alert.alert("Revoke", `Revoke "${c.name}"? Its token stops working immediately.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Revoke",
        style: "destructive",
        onPress: async () => {
          try {
            await revokeClient(c.id);
            setClients(await listClients());
          } catch (e) {
            Alert.alert("MCP", e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Server</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Enabled</Text>
          <Switch value={enabled} onValueChange={toggle} disabled={busy}
            trackColor={{ false: colors.disabled, true: colors.accent }} />
        </View>
        {enabled && (
          <Text style={styles.hint}>
            {ip ? `http://${ip}:${MCP_PORT}/mcp` : "Getting LAN address…"}
            {"\n"}Only reachable on this Wi-Fi. Data stays on the phone.
          </Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>Clients</Text>
      <View style={styles.card}>
        {clients.length === 0 && <Text style={styles.hint}>No clients yet.</Text>}
        {clients.map((c) => (
          <View key={c.id} style={styles.row}>
            <Text style={styles.label} numberOfLines={1}>{c.name}</Text>
            <TouchableOpacity onPress={() => revoke(c)}>
              <Text style={styles.revoke}>Revoke</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TextInput
          style={styles.input}
          value={newName}
          onChangeText={setNewName}
          placeholder="Name this client (e.g. MacBook — Claude Code)"
          placeholderTextColor={colors.textPlaceholder}
        />
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={addClient} activeOpacity={0.8} disabled={!newName.trim()}>
          <Text style={styles.btnPrimaryText}>Add client</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  sectionTitle: { ...typography.sectionTitle, color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm, gap: spacing.md },
  label: { ...typography.body, color: colors.textPrimary, flexShrink: 1 },
  hint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  revoke: { ...typography.body, color: colors.error, fontWeight: "600" },
  input: { ...typography.body, color: colors.textPrimary, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.md },
  btn: { borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: { ...typography.button, color: colors.userText },
});
