// A dismissible, auto-clearing amber banner for non-fatal notices (a save
// failed, a model didn't load). Distinct from the red error banner: the turn
// SUCCEEDED, so this must not read as a hard failure and must never trap the
// user — it fades on tap or after a timeout.
//
// Reusable on purpose (chat uses it today; models/documents can adopt it and
// drop their hand-rolled banners): it takes a message + onDismiss and owns
// nothing but its auto-dismiss timer.

import { useEffect } from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { colors, spacing } from "../lib/theme";

const AUTO_DISMISS_MS = 6000;

interface Props {
  message: string | null;
  onDismiss: () => void;
}

export function NoticeBanner({ message, onDismiss }: Props) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    // Re-arm on a new message; clear on unmount so a dismiss never fires late
    // against a stale notice.
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <TouchableOpacity
      style={styles.banner}
      onPress={onDismiss}
      activeOpacity={0.8}
      accessibilityRole="alert"
    >
      <Text style={styles.text}>{message}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.warningBg,
    paddingVertical: 8,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.warning,
  },
  text: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: "500",
  },
});
